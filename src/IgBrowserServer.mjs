import crypto from 'crypto';
import express from 'express';
import {IgBrowser} from './IgBrowser.mjs';

export class IgBrowserServer {
	constructor(options) {
		this.app = express(); 
		this.app.use(express.json());
		this.app.use(express.urlencoded({
			extended: false
		}));
		
		this.browser = false;
		this.queue = [];
		this.tasks = {};
		
		this.options = Object.assign({
			host:	'127.0.0.1',
			port:	3000
		}, options);
	}
	
	run() {
		this.app.use((err, req, res, next) => {
			console.error(err.stack)
			res.status(500).send('Internal server error!');
		});
		
		this.app.use((req, res, next) => {
			if (this.options.allow.length && !this.options.allow.includes(req.connection.remoteAddress)) {
				return res.status(403).send('Access Denied.');
			} else {
				next();
			}
		});
		
		this.app.get('/queue-login', (req, res) => {
			let out = {};
			
			if (!req.query.username) {
				out.status = 400;
				out.error = "Invalid user name";
			} else if (!req.query.password) {
				out.status = 400;
				out.error = "Invalid user password";
			} else {
				let uniqid = this.addToQueue('login', {
					username:	req.query.username.toLowerCase(),
					password:	req.query.password.toLowerCase()
				});
				
				out.status = 200;
				out.id = uniqid;
			}
			
			return res.send(out);
		});
		
		this.app.get('/queue-check-login', async (req, res) => {
			let uniqid = this.addToQueue('check-login', {});
			return res.send({status: 200, id: uniqid});
		});
		
		this.app.get('/queue-collect', (req, res) => {
			let out = {};
			
			if (!["user", "hashtag"].includes(req.query.type)) {
				out.status = 400;
				out.error = "Invalid source type";
			} else if (!req.query.name) {
				out.status = 400;
				out.error = "Invalid source name";
			} else {
				let uniqid = this.addToQueue('collect', {
					name:	req.query.name.toLowerCase(),
					type:	req.query.type.toLowerCase()
				});
				
				out.status = 200;
				out.id = uniqid;
			}
			
			return res.send(out);
		});
		
		this.app.get('/status', (req, res) => {
			let out = {};
			
			let task = this.tasks[req.query.id];
			if (task) {
				if (task.result) {
					out.status = 200;
					out.result = task.result;
				} else {
					out.status = 202;
				}
			} else {
				out.status = 404;
				out.error = "Task not found";
			}
			
			return res.send(out);
		});
		
		setInterval(function () {
			for (let task_id in this.tasks) {
				let task = this.tasks[task_id];
				if (task.result && Date.now() - task.atime > 300000)
					delete this.tasks[task_id];
			}
		}, 30000);
		
		console.log('# running server on: http://' + this.options.host + ':' + this.options.port);
		this.app.listen(this.options.port, this.options.host);
	}
	
	addToQueue(type, data) {
		let uniqid = md5([
			'queue',
			type,
			JSON.stringify(data)
		].join(":"));
		
		if (this.tasks[uniqid] && this.tasks[uniqid].result)
			delete this.tasks[uniqid];
		
		if (!this.tasks[uniqid]) {
			let entry = {
				id:		uniqid,
				type:	type,
				data:	data,
				ctime:	Date.now(),
				atime:	Date.now(),
				result:	false
			};
			this.queue.push(uniqid);
			this.tasks[uniqid] = entry;
		}
		
		this.tasks[uniqid].atime = Date.now();
		
		if (!this.in_processing) {
			this.in_processing = true;
			this.processQueue();
		}
		
		return uniqid;
	}
	
	async processQueue() {
		while (this.queue.length > 0) {
			let task_id = this.queue.shift();
			let task = this.tasks[task_id];
			
			if (this.browser_stop_timeout) {
				clearTimeout(this.browser_stop_timeout);
				this.browser_stop_timeout = false;
			}
			
			console.log('# process task: ' + task_id + ' (' + task.type + ')');
			
			task.start = Date.now();
			let browser = await this.getBrowser();
			
			switch (task.type) {
				case "check-login":
					task.result = await this.browser.checkAuth();
				break;
				
				case "login":
					task.result = await this.browser.login(task.data.username, task.data.password);
				break;
				
				case "collect":
					if (task.data.type == "user") {
						task.result = await this.browser.exploreUser(task.data.name);
					} else if (task.data.type == "hashtag") {
						task.result = await this.browser.exploreTag(task.data.name);
					} else {
						task.result = {};
					}
				break;
			}
			task.end = Date.now();
			task.atime = Date.now();
			
			console.log('# task done (' + (task.end - task.start) + ' ms)');
			
			this.browser_stop_timeout = setTimeout(() => this.stopBrowser(), 30000);
		}
		
		this.in_processing = false;
	}
	
	async stopBrowser() {
		if (this.in_processing)
			return;
		
		console.log('# close browser due to inactivity...');
		await this.browser.close();
		this.browser = false;
	}
	
	async getBrowser() {
		if (!this.browser) {
			this.browser = new IgBrowser();
			await this.browser.init();
		}
		return this.browser;
	}
}

function md5(data) {
	return crypto.createHash('md5').update(data).digest("hex");
}
