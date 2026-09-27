// A small builder for the game's map scripts (the JS a map module runs: what the Level Editor saves, minus its
// `//->Ditto->//` editor notes). Used by the harness for test rigs; the campaign's own levels are built from the
// editor's object templates instead, so they stay editable.
//
//   const m = new MapJS();
//   m.world( { sky_color: '0x203040' } );
//   const rock = m.surface( 'rock', 'rock_slice', 'Rock' );
//   m.box( -1000, 0, 2000, 200, rock );
//   m.player( 0, -40 );
//   const js = m.build();
const WORLD_DEFAULTS = {
	x: 40, y: 0, background_terrain_random_seed: 12, foreground_terrain_random_seed: 23, foreground_platform_random_seed: 34, foliage_random_seed: 56,
	foliage_shadow_multiplier: 1, wind_amplitude: -1, wind_random_part: 0.75, foliage_maximum_animation_distance: 1000, sun_color: '0xdde7ff', sun_intensity: 0.025,
	sky_color: '0xdde7ff', sky_intensity: 0.6, foreground_snow: false, background_snow: false, snowing: false, raining: false, fog_intensity: 0, sun_shade_x: 150,
	sun_shade_y: 3000, brightness: 1, prefer_high_quality_reflections: false, fake_shadow_opacity: 1, camera_collisions: false, generate_shadowmap: true,
	camera_projection_mode: 0, terrain_enabled: false
};
const lit = ( v )=>typeof v === 'string' ? v : JSON.stringify( v );   // strings are code (e.g. 'pb2Shape.WALL', "'Name'")
const obj = ( o )=>'{ ' + Object.entries( o ).map( ( [ k, v ] )=>k + ': ' + lit( v ) ).join( ', ' ) + ' }';
class MapJS
{
	constructor() { this.vars = []; this.lines = []; this.n = 0; this.hasWorld = false; }
	v( prefix ) { const id = prefix + '_' + ( ++this.n ); this.vars.push( id ); return id; }
	raw( code ) { this.lines.push( code ); return this; }
	world( o = {} )
	{
		this.hasWorld = true;
		const w = Object.assign( {}, WORLD_DEFAULTS, o );
		this.raw( Object.entries( w ).map( ( [ k, v ] )=>'pb2GameWorld.' + k + ' = ' + lit( v ) + ';' ).join( ' ' ) );
		this.raw( 'pb2GameWorld.EnableSimplePlayerAssignmentLogic();' );
		return this;
	}
	skin( frame ) { const id = this.v( 'skin' ); this.raw( id + ' = pb2SkinEditor.SpawnDefaultSkin( ' + frame + ' );' ); return id; }
	surface( name, texture = 'rock_slice', o = {} )
	{
		const id = this.v( 'surf' );
		const p = Object.assign( { geometry_type: 'pb2SurfaceType.TYPE_SIMPLE_WALL', texture_container: "pb2Texture.GetTextureByName('" + texture + "')", name: "'" + name + "'",
			terrain_generation: false, has_cliff: false, has_ground: false, is_for_wall: true, shader_type: 'pb2SurfaceType.SHADER_GAMEPLAY', pixelated: false, mipmaps: true,
			transparent: false, opacity: 1, color: 'new pb2HighRangeColor( 0xffffff )', color_addon: 'new pb2HighRangeColor( 0x000000 )', appearance: 'pb2SurfaceType.APPEARANCE_NORMAL',
			recommended_slices_per_density: 5, debris_material: 'pb2Entity.MATERIAL_CONCRETE', movable_sounds_preset: null, slice_texture_container: null,
			slice_color: 'new pb2HighRangeColor( 0xffffff )', slice_color_addon: 'new pb2HighRangeColor( 0x000000 )', slice_pixelated: false, slice_transparent: false,
			slice_appearance: 'pb2SurfaceType.APPEARANCE_NORMAL', slice_opacity: 1, slice_scale: 1, impact_scale: 1, allow_decals: true, camera_collisions: false,
			uv_x: 0, uv_y: 0, uv_z: 0, uv_sx: 1, uv_sy: 1, uv_sz: 1 }, o );
		this.raw( id + ' = pb2SurfaceType.CreateSurfaceType(' + obj( p ) + ');' );
		return id;
	}
	box( x, y, w, h, m, type = 'pb2Shape.WALL', extra = {} )
	{
		this.raw( 'pb2GameWorld.CreateBoxShape(' + obj( Object.assign( { x, y, w, h, m, type }, extra ) ) + ');' );
		return this;
	}
	// a liquid kind (pb2WaterClass: type pb2WaterClass.TYPE_WATER / _TOXIC / _CORROSIVE / _LAVA / _FREEZING / _ZERO_GRAVITY…,
	// color, opacity, viscosity, density, reflection, glow, depth, depth_front, extend_left / right, damage_scale)
	waterClass( o = {} )
	{
		const id = this.v( 'liquid' );
		this.raw( id + ' = pb2WaterClass.DeclareWaterClass(' + obj( Object.assign( { type: 'pb2WaterClass.TYPE_WATER', color: '0x0b3a4a', opacity: 0.7, reflection: true }, o ) ) + ');' );
		return id;
	}
	// a box of it (its surface at y, its bottom at y + h)
	water( x, y, w, h, wc ) { this.raw( 'pb2GameWorld.CreateBoxShape(' + obj( { x, y, w, h, wc } ) + ', pb2Shape.WATER);' ); return this; }
	team( title, o = {} )
	{
		const id = this.v( 'team' );
		const p = Object.assign( { ai_in_team: false, title: "'" + title + "'", hud_color: 'new pb2HighRangeColor( 0x6a94ff )', recolor_nicknames_on_overhead: false, recolor_skins: false,
			friendly_fire: false, friendly_damage_multiplier: 1, normal_damage_to_dead_teammates: true, teammates_collide: true, allow_private_communication: true,
			overheads_visibility: 'pb2OverheadHUD.OVERHEAD_VISIBILITY_TEAMMATES_ONLY' }, o );
		this.raw( id + ' = pb2Team.CreateTeam(' + obj( p ) + ');' );
		return id;
	}
	character( x, y, skin, team, o = {} )
	{
		const p = Object.assign( { x, y, skin, team, vision: 'pb2Vision.VISION_SCREEN_BOX', style_boost: 'pb2StyleBoost.SELFBOOST', style_swords: 'pb2StyleSwords.BASIC',
			driver_of: null, sword_projectile_reflection: false, hmax: 150, can_be_revived: false, can_breathe_in_water: false, can_breathe_in_toxic_clouds: false,
			regen_module: 'pb2StyleRegen.style_delayed_speedup', drop_guns_on_death: 'pb2Character.DROP_ALWAYS', drop_grenades_on_death: 'pb2Character.DROP_WHEN_INTENDED_ONLY',
			enforce_skin_limitations: false, use_skin_properties: false, player_controllable: false, ai_preset: null, side: 1 }, o );
		const id = this.v( 'char' );
		this.raw( id + ' = pb2Ragdoll.CreateRagdollComplete(' + obj( p ) + ');' );
		return id;
	}
	player( x, y, skin, team, o = {} ) { return this.character( x, y, skin, team, Object.assign( { player_controllable: true }, o ) ); }
	// a gun lying at (x, y): type like 'gun_rifle'; only_allow_for a team or a character's variable
	gun( type, x, y, o = {} ) { const id = this.v( 'gun' ); this.raw( id + ' = pb2Gun.CreateGun(' + obj( Object.assign( { type: "'" + type + "'", x, y }, o ) ) + ');' ); return id; }
	entity( type, x, y, o = {} ) { const id = this.v( 'ent' ); this.raw( id + ' = pb2Entity.CreateEntity(' + obj( Object.assign( { type, x, y }, o ) ) + ');' ); return id; }
	build()
	{
		if ( !this.hasWorld ) throw new Error( 'MapJS: world() first' );
		return ( this.vars.length ? 'var ' + this.vars.join( ', ' ) + ';\n' : '' ) + this.lines.join( '\n' ) + '\npb2GameWorld.FinalizeWorld();';
	}
}
module.exports = { MapJS };
