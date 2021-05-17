import puppeteer from 'puppeteer-core';
import {dirname} from 'path';
import {fileURLToPath} from 'url';
import fs from 'fs';
import URL from 'url';
import {mouseMove, mouseMoveAndClick, rand, delay} from './utils.mjs';

export class IgBrowser {
	constructor() {
		
	}
	
	async init() {
		let chromium_dir = "/tmp/chromium-instagram";
		fs.mkdirSync(chromium_dir, {recursive: true});
		
		let browser_hangs_timeout = setTimeout(() => {
			this.error('Oh no! Browser hangs!!!1');
			process.exit();
		}, 60000);
		
		this.info('Puppeteer launch...');
		this.browser = await puppeteer.launch({
			executablePath:		dirname(fileURLToPath(import.meta.url)) + "/chromium.sh",
			headless:			false,
			ignoreDefaultArgs:	true,
			pipe:				true,
			userDataDir:		chromium_dir,
			args:				[
				'--disable-background-networking',
				'--enable-features=NetworkService,NetworkServiceInProcess',
				'--disable-background-timer-throttling',
				'--disable-backgrounding-occluded-windows',
				'--disable-breakpad',
				'--disable-client-side-phishing-detection',
				'--disable-component-extensions-with-background-pages',
				'--disable-default-apps',
				'--disable-dev-shm-usage',
				'--disable-features=Translate,site-per-process',
				'--disable-hang-monitor',
				'--disable-ipc-flooding-protection',
				'--disable-popup-blocking',
				'--disable-prompt-on-repost',
				'--disable-renderer-backgrounding',
				'--disable-sync',
				'--disable-automation',
				'--force-color-profile=srgb',
				'--metrics-recording-only',
				'--no-first-run',
				'--password-store=basic',
				'--use-mock-keychain',
				'--enable-blink-features=IdleDetection',
				'--disable-blink-features=AutomationControlled',
				'--lang=ru',
				'--start-fullscreen',
				'--display=:99',
				'--flag-switches-begin',
				'--disable-site-isolation-trials',
				'--flag-switches-end',
				'--enable-webgl',
				'--use-gl=desktop',
				'--ignore-gpu-blocklist',
				'--ignore-gpu-blacklist',
				'--user-data-dir=' + chromium_dir
			]
		});
		
		this.graphql_handlers = [];
		
		this.info('Puppeteer new page...');
		this.page = await this.browser.newPage();
		
		// Log console
		this.page.on('console', message => this.info(`${message.type()}: ${message.text()}`));
		
		// Emulate connection RTT
		let session = await this.page.target().createCDPSession();
		await session.send('Network.emulateNetworkConditions', {
			downloadThroughput: 1.6 * 1024 * 1024 / 8 * .9,
			uploadThroughput: 750 * 1024 / 8 * .9,
			latency: 150 * 3.75,
			offline: false,
		});
		
		// Emulate dialog close
		await this.page.on('dialog', async dialog => {
			console.log("dialog: " + dialog.message());
			await delay(rand(1000, 3000));
			await dialog.dismiss();
		});
		
		// Enable low-end linux desktop emulation
		await this.page.emulate({
			name: 'Desktop',
			userAgent: 'Mozilla/5.0 (X11; Linux i686) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
			viewport: {
				width: 1366,
				height: 768,
				deviceScaleFactor: 1,
				isMobile: false,
				hasTouch: false,
				isLandscape: false
			}
		});
		
		// Enable request interception
		await this.page.setRequestInterception(true);
		
		// Disable cache
		await this.page.setCacheEnabled(false);
		
		// Log all network requests
		this.page.on('request', async (req) => {
			if (req.url().indexOf('data:') !== 0) {
				let parsed_url = URL.parse(req.url(), true);
				if (!parsed_url.hostname.match(/(^|\.)(instagram\.com|cdninstagram\.com|facebook\.net|fbcdn\.net)$/i)) {
					this.warn(`SKIP ${req.resourceType()}: ${req.method()} ${req.url()}`);
					req.abort();
					return;
				}
			}
			
			if (!req.resourceType().match(/^(image|stylesheet|script)$/)) {
				this.info(`${req.resourceType()}: ${req.method()} ${req.url()}`);
				/*
				if (req.url().indexOf('/ajax/bz') >= 0 || req.url().indexOf('/logging') >= 0) {
					try {
						this.info(decodeURIComponent(await req.postData()));
					} catch (e) { }
				}
				*/
			}
			
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
		
		// Stop hangs detector
		clearTimeout(browser_hangs_timeout);
		
		this.info('Puppeteer initialized!');
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
			await delay(rand(1000, 2000));
			
			// Need accept cookie usage
			let need_cookie_accept = await this.page.$x('//div[contains(., "Accept cookies from Instagram")]');
			if (need_cookie_accept.length > 0) {
				this.info('need accept cookies usage...');
				let cookie_accept_button = await this.page.$x('//button[contains(., "Accept")]');
				
				if (cookie_accept_button.length > 0) {
					this.info('-> click Accept button');
					await mouseMoveAndClick(this.page, cookie_accept_button[0]);
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
			
			await mouseMove(this.page, await this.page.$('input[name=username]'));
			await this.page.type('input[name=username]', username, {delay: rand(50, 100)});
			await delay(rand(300, 500));
			
			this.info('Fill password...');
			await mouseMove(this.page, await this.page.$('input[name=password]'));
			await this.page.type('input[name=password]', password, {delay: rand(100, 300)});
			await delay(rand(300, 500));
			
			this.info('Click "Log In" button...');
			let login_btn = await this.page.$x('//button[contains(., "Log In")]');
			
			if (login_btn.length) {
				await mouseMoveAndClick(this.page, login_btn[0]);
				await delay(rand(2000, 3000));
				await this.page.screenshot({path: '/home/azq2/apps/xujxuj/www/files/test-screenshot.png'});
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
				
				await mouseMove(this.page, await this.page.$('[title="Month:"]'));
				await this.page.select('[title="Month:"]', '11');
				await delay(rand(300, 500));
				
				await mouseMove(this.page, await this.page.$('[title="Year:"]'));
				await this.page.select('[title="Year:"]', '1991');
				await delay(rand(300, 500));
			
				await mouseMove(this.page, await this.page.$('[title="Day:"]'));
				await this.page.select('[title="Day:"]', '1');
				await delay(rand(300, 500));
				
				if (btns.length > 0) {
					this.info('-> Click "Accept" button');
					await mouseMoveAndClick(this.page, btns[0]);
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
			result_graphql.new = hashtag_new_edges;
			all_edges = all_edges.concat(result_graphql.new);
		}
		
		let hashtag_top_edges = graphql?.hashtag?.edge_hashtag_to_top_posts?.edges;
		if (hashtag_top_edges) {
			result_graphql.top = hashtag_top_edges;
			all_edges = all_edges.concat(result_graphql.top);
		}
		
		let user_edges = graphql?.user?.edge_owner_to_timeline_media?.edges;
		if (user_edges) {
			result_graphql.all = user_edges;
			all_edges = all_edges.concat(result_graphql.all);
		}
		
		if (!all_edges.length) {
			this.warn('No edges found, empty page');
		} else {
			this.info('Found ' + all_edges.length + ' edges');
		}
		
		try {
			let limit = 5;
			
			for (let edge of all_edges) {
				if (edge.node.__typename == "GraphSidecar" || edge.node.__typename == "GraphVideo") {
					if (edge.node.__typename == "GraphSidecar" && edge.node.edge_sidecar_to_children)
						continue;
					if (edge.node.__typename == "GraphVideo" && edge.node.video_url)
						continue;
					
					if (!limit) {
						edge_replaces[edge.node.shortcode] = {node: false};
						continue;
					}
					
					limit--;
					
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
					await mouseMoveAndClick(this.page, shortcode_el);
					
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
					await delay(rand(1000, 2000));
					await this.page.goBack();
					await delay(rand(3000, 4000));
				}
			}
		} catch (e) {
			this.error(`Can't get extra info for special edges!`);
			this.error(e);
		}
		
		for (let k in result_graphql) {
			result_graphql[k] = result_graphql[k].filter(function (old_edge) {
				return !edge_replaces[old_edge.node.shortcode] || edge_replaces[old_edge.node.shortcode].node;
			}).map(function (old_edge) {
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
