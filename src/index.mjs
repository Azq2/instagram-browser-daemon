import yargs from 'yargs';
import {hideBin} from 'yargs/helpers';
import {IgBrowserServer} from './IgBrowserServer.mjs';

let argv = yargs(hideBin(process.argv)).argv

let app = new IgBrowserServer({
	host:	argv.host || '127.0.0.1',
	port:	argv.port || 3000,
	allow:	argv.allowFrom ? argv.allowFrom.split(/\s*,\s*/) : []
});
app.run();
