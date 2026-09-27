// Where the work stands in git: node levels/git-state.js [paths…] → one JSON line: the branch, whether the given paths
// (default: the mod, the extension bundle, the level's docs and harness) have changes not committed, and whether the
// branch's last commit is the one on origin.
const cp = require( 'child_process' ), path = require( 'path' );
const root = path.join( __dirname, '..', '..', '..' );
const git = ( ...a )=>{ const r = cp.spawnSync( 'git', a, { cwd: root, encoding: 'utf8' } ); return ( r.stdout || '' ).trim(); };
const paths = process.argv.slice( 2 ).length ? process.argv.slice( 2 ) : [ 'mods', 'pb3x-extension/pb3x.js', 'docs/cs-coastal-tower', 'tools/harness' ];
const branch = git( 'rev-parse', '--abbrev-ref', 'HEAD' ), head = git( 'rev-parse', 'HEAD' );
const remote = git( 'rev-parse', 'origin/' + branch );
const dirty = git( 'status', '--porcelain', '--', ...paths ).split( '\n' ).filter( Boolean ).filter( ( l )=>!/results\//.test( l ) && !/docs\/cs-coastal-tower\/loop\//.test( l ) );   // (the loop's own record changes while it observes)
console.log( JSON.stringify( { branch, head: head.slice( 0, 12 ), remote: remote.slice( 0, 12 ), pushed: !!head && head === remote, uncommitted: dirty.length, dirty: dirty.slice( 0, 20 ) } ) );
