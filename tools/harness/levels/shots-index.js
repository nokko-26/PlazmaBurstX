// What a level's published screenshots are: node levels/shots-index.js <level>  → one JSON line
// (docs/cs-coastal-tower/shots/<level>/: each .jpg, its size, and how many are the editor's angled 2.5D views)
const fs = require( 'fs' ), path = require( 'path' );
const level = process.argv[ 2 ] || '06';
const dir = path.join( __dirname, '..', '..', '..', 'docs', 'cs-coastal-tower', 'shots', level );
const files = fs.existsSync( dir ) ? fs.readdirSync( dir ).filter( ( f )=>/\.jpg$/.test( f ) && f !== 'sheet.jpg' ).sort() : [];
const names = files.map( ( f )=>f.replace( /\.jpg$/, '' ) );
console.log( JSON.stringify( { level, dir: path.relative( path.join( __dirname, '..', '..', '..' ), dir ), count: names.length, names,
	altViews: names.filter( ( n )=>/^ed-alt-/.test( n ) ).length, editorFlat: names.filter( ( n )=>/^ed-flat-/.test( n ) ).length,
	eyeLevel: names.filter( ( n )=>/^eye-/.test( n ) ).length, lane: names.filter( ( n )=>/^lane-/.test( n ) ).length, overviews: names.filter( ( n )=>/^overview-/.test( n ) ).length,
	coop: names.filter( ( n )=>/coop/.test( n ) ).length, sheet: fs.existsSync( path.join( dir, 'sheet.jpg' ) ) } ) );
