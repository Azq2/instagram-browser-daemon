import puppeteer from 'puppeteer-core';
import {dirname} from 'path';
import {fileURLToPath} from 'url';
import fs from 'fs';
import URL from 'url';

const MAX_EDGES = 12;

export class IgBrowser {
	constructor() {
		
	}
	
	async init() {
		let chromium_dir = dirname(fileURLToPath(import.meta.url)) + "/../node_modules/.cache/chromium";
		
		fs.mkdirSync(chromium_dir, {recursive: true});
		
		this.browser = await puppeteer.launch({
			executablePath:		"/usr/bin/chromium",
			headless:			true,
			userDataDir:		chromium_dir 
		});
		
		this.graphql_handlers = [];
		
		this.page = await this.browser.newPage();
		
		// Log console
		this.page.on('console', message => this.info(`${message.type()}: ${message.text()}`));
		
		// Log all network requests
		this.page.on('request', (req) => {
			if (req.url().indexOf('data:') !== 0) {
				let parsed_url = URL.parse(req.url(), true);
				if (!parsed_url.hostname.match(/(^|\.)(instagram\.com|cdninstagram\.com|facebook\.net|fbcdn\.net)$/i)) {
					this.warn(`SKIP ${req.resourceType()}: ${req.method()} ${req.url()}`);
					req.abort();
					return;
				}
			}
			
			if (!req.resourceType().match(/^(image|stylesheet|script)$/))
				this.info(`${req.resourceType()}: ${req.method()} ${req.url()}`);
			req.continue();
		});
		
		// Log all network responses
		this.page.on('response', async (response) => {
			if (response.request().resourceType() == "xhr") {
				if (response.url().indexOf('https://www.instagram.com/graphql/query') === 0 || response.url().indexOf('__a=1') > 0) {
					let json;
					try {
						json = await response.json()
					} catch (e) { }
					
					if (json) {
						let new_graphql_handlers = [];
						for (let handler of this.graphql_handlers) {
							if (!handler(response.url(), json))
								new_graphql_handlers.push(handler);
						}
						this.graphql_handlers = new_graphql_handlers;
					}
				}
			}
		});
		
		// Enable mobile emulation
		await this.page.emulate(puppeteer.devices["Nexus 4"]);
		await this.page.setRequestInterception(true);
		
		// Disable cache
		await this.page.setCacheEnabled(false);
	}
	
	getUser() {
		return this.user;
	}
	
	waitGraphql(filter_callback, timeout) {
		return new Promise((resolve, reject) => {
			let timeout_id = setTimeout(() => {
				this.graphql_handlers = this.graphql_handlers.filter((v) => {
					return v !== filter_callback;
				});
				reject(new Error("Timeout reached when wait graphql response..."));
			}, timeout);
			
			this.graphql_handlers.push((url, json) => {
				if (filter_callback(url, json)) {
					clearTimeout(timeout_id);
					resolve({url, json});
					return true;
				}
				return false;
			});
		});
	}
	
	async login(username, password) {
		try {
			let auth = await this.checkAuth();
			if (auth.logged) {
				if (auth.username.toLowerCase() == username.toLowerCase()) {
					this.info(`Allready logged to ${username}`);
					return auth;
				}
				await igLogout();
			}
			
			await this.page.goto('https://www.instagram.com/accounts/login/', {waitUntil: 'domcontentloaded'});
			
			// Need accept cookie usage
			let need_cookie_accept = await this.page.$x('//div[contains(., "Accept cookies from Instagram")]');
			if (need_cookie_accept.length > 0) {
				this.info('need accept cookies usage...');
				let cookie_accept_button = await this.page.$x('//button[contains(., "Accept")]');
				
				if (cookie_accept_button.length > 0) {
					this.info('-> click Accept button');
					await cookie_accept_button[0].click({
						delay: rand(300, 500)
					});
				} else {
					return {
						logged:	false,
						error:	"Can't find cookies accept button"
					};
				}
			}
			
			this.info('Wait for user login form....');
			await this.page.waitForSelector('input[name=username]', {visible: true});
			
			this.info('Fill username...');
			await this.page.type('input[name=username]', username, {delay: rand(50, 100)});
			await delay(rand(300, 500));
			
			this.info('Fill password...');
			await this.page.type('input[name=password]', password, {delay: rand(100, 300)});
			await delay(rand(300, 500));
			
			this.info('Click "Log In" button...');
			let login_btn = await this.page.$x('//button[contains(., "Log In")]');
			
			if (login_btn.length) {
				await login_btn[0].click({
					delay: rand(30, 50)
				});
				await this.page.waitForNavigation();
			} else {
				return {
					logged:	false,
					error:	"Can't find login button"
				};
			}
			
			await delay(rand(300, 500));
		} catch (e) {
			console.error(e);
			return {
				logged:	false,
				error:	e.message
			};
		}
		
		return this.checkAuth();
	}
	
	async checkAuth() {
		try {
			await this.page.goto('https://www.instagram.com/', {waitUntil: 'domcontentloaded'});
			
			await delay(rand(300, 500));
			
			// Need accept age
			let need_confirm_age = await this.page.$x('//div[contains(., "Enter Your Date of Birth")]');
			if (need_confirm_age.length > 0) {
				this.info('Need accept age...');
				let btns = await this.page.$x('//button[contains(., "Submit")]');
				
				await this.page.select('[title="Month:"]', '11');
				await delay(rand(300, 500));
				
				await this.page.select('[title="Year:"]', '1991');
				await delay(rand(300, 500));
			
				await this.page.select('[title="Day:"]', '1');
				await delay(rand(300, 500));
				
				if (btns.length > 0) {
					this.info('-> Click "Accept" button');
					await btns[0].click({
						delay: rand(300, 500)
					});
					await this.page.waitForNavigation();
					await delay(rand(300, 500));
				} else {
					this.info('-> Can\'t find age accept buttton!');
				}
			}
			
			let shared_data = await this.page.evaluate(() => window._sharedData);
			this._checkSharedData(shared_data);
			
			if (this.user) {
				return {
					logged:		true,
					id:			this.user.id,
					username:	this.user.username
				};
			}
			
			return {
				logged:		false
			};
		} catch (e) {
			this.error(e);
			return {
				logged:	false,
				error:	e.message
			};
		}
	}
	
	async exploreTag(tag) {
		try {
			this.info('Load tag: ' + tag);
			let url = 'https://www.instagram.com/explore/tags/' + encodeURIComponent(tag) + '/?utm_source=ig_seo&utm_campaign=hashtags&utm_medium=';
			await this.page.goto(url, {waitUntil: 'domcontentloaded'});
			return await this._parseFeed();
		} catch (e) {
			this.error(e);
			return {
				graphql:	false,
				error:		e.message
			};
		}
	}
	
	async exploreUser(user) {
		try {
			this.info('Load user: ' + user);
			let url = 'https://www.instagram.com/' + encodeURIComponent(user) + '/?utm_source=ig_seo&utm_campaign=profiles&utm_medium=';
			await this.page.goto(url, {waitUntil: 'domcontentloaded'});
			return await this._parseFeed();
		} catch (e) {
			this.error(e);
			return {
				graphql:	false,
				error:		e.message
			};
		}
	}
	
	async _parseFeed(tag) {
		let result_graphql = {};
		let edge_replaces = {};
		
		let shared_data = await this.page.evaluate(() => window._sharedData);
		this._checkSharedData(shared_data);
		
		if (!this.user)
			throw new Error('Not authenficated');
		
		// Find entry data
		let graphql = shared_data?.entry_data?.TagPage?.[0]?.graphql;
		if (!graphql)
			graphql = shared_data?.entry_data?.ProfilePage?.[0]?.graphql;
		
		let all_edges = [];
		
		// Find edges
		let hashtag_new_edges = graphql?.hashtag?.edge_hashtag_to_media?.edges;
		if (hashtag_new_edges) {
			result_graphql.new = hashtag_new_edges.slice(0, MAX_EDGES);
			all_edges = all_edges.concat(result_graphql.new);
		}
		
		let hashtag_top_edges = graphql?.hashtag?.edge_hashtag_to_top_posts?.edges;
		if (hashtag_top_edges) {
			result_graphql.top = hashtag_top_edges;
			all_edges = all_edges.concat(result_graphql.top);
		}
		
		let user_edges = graphql?.user?.edge_owner_to_timeline_media?.edges;
		if (user_edges) {
			result_graphql.all = user_edges.slice(0, MAX_EDGES);
			all_edges = all_edges.concat(result_graphql.all);
		}
		
		if (!all_edges.length) {
			this.warn('No edges found, empty page');
		} else {
			this.info('Found ' + all_edges.length + ' edges');
		}
		
		try {
			for (let edge of all_edges) {
				if (edge.node.__typename == "GraphSidecar" || edge.node.__typename == "GraphVideo") {
					if (edge.node.__typename == "GraphSidecar" && edge.node.edge_sidecar_to_children)
						continue;
					if (edge.node.__typename == "GraphVideo" && edge.node.video_url)
						continue;
					
					this.info(`-> Found ${edge.node.__typename}(${edge.node.id}), need fetch additional data`);
					
					this.info('--> scroll to edge...');
					let shortcode_el;
					for (let i = 0; i < 100; i++) {
						shortcode_el = await this.page.$('a[href*="/' + edge.node.shortcode + '/"]');
						if (!shortcode_el) {
							await this.page.evaluate(() => {
								window.scrollTo(0, document.documentElement.scrollTop + 33);
							});
							await delay(rand(10, 50));
						}
					}
					
					await this.page.hover('a[href*="/' + edge.node.shortcode + '/"]');
					
					if (!shortcode_el) {
						this.error('--> edge element not found!!!');
						continue;
					}
					
					let graphql_promise = this.waitGraphql((url, json) => {
						if (url.indexOf('/p/' + edge.node.shortcode) >= 0)
							return true;
						
						let variables;
						try {
							let parsed_url = URL.parse(url, true);
							variables = JSON.parse(parsed_url.query.variables);
						} catch (e) { }
						
						if (variables && variables.shortcode == edge.node.shortcode)
							return true;
					}, 10000);
					
					this.info('--> click to edge element');
					await shortcode_el.click({delay: rand(10, 50)});
					
					try {
						this.info('--> wait for edge graphql...');
						let api_response = (await graphql_promise).json;
						
						let edge_node = api_response?.graphql?.shortcode_media;
						if (!edge_node)
							edge_node = api_response?.data?.shortcode_media;
						
						if (!edge_node)
							throw new Error("Edge node data not found!");
						
						edge_replaces[edge_node.shortcode] = {node: edge_node};
					} catch (e) {
						this.error('--> edge not found?');
						this.error(e);
					}
					
					this.info('--> done, close edge page...');
					await delay(rand(800, 1200));
					await this.page.goBack();
					await delay(rand(300, 400));
				}
			}
		} catch (e) {
			this.error(`Can't get extra info for special edges!`);
			this.error(e);
		}
		
		for (let k in result_graphql) {
			result_graphql[k] = result_graphql[k].map(function (old_edge) {
				return edge_replaces[old_edge.node.shortcode] || old_edge;
			});
		}
		
		return {
			graphql:	result_graphql
		};
	}
	
	async logout() {
		let client = await this.page.target().createCDPSession();
		await client.send('Network.clearBrowserCookies');
		await client.send('Network.clearBrowserCache');
	}
	
	_checkSharedData(shared_data) {
		if (shared_data && shared_data.config && shared_data.config.viewer) {
			this.user = {
				id:			shared_data.config.viewer.id,
				username:	shared_data.config.viewer.username,
				checked:	Date.now()
			};
		}
	}
	
	async close() {
		if (this.page)
			await this.page.close();
		
		if (this.browser)
			await this.browser.close();
	}
	
	info() {
		console.log.call(console, '[info]', ...arguments);
	}
	
	error() {
		console.error.call(console, '[error]', ...arguments);
	}
	
	warn() {
		console.warn.call(console, '[warning]', ...arguments);
	}
};

async function delay(timeout) {
	return await new Promise((resolve, reject) => {
		setTimeout(resolve, timeout);
	});
}

function rand(min, max) {
	return Math.random() * (max - min) + min;
}
