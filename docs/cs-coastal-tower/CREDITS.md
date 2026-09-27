# Credits — CS Coastal Tower: Underhang

Every third-party file shipped in `pb3x-extension/assets/` is listed here. Only public-domain / CC0 material is
used (no attribution is required by CC0; it is given anyway). Each file was converted by the script named in its
section, which re-downloads the sources and rebuilds the files, so every file can be traced and reproduced.

## Skies — `assets/skies/` (`tools/assets/skies.py`)

Source: [Poly Haven](https://polyhaven.com) HDRIs, licence **CC0 1.0** (https://polyhaven.com/license). 4K `.hdr`,
auto-exposed, graded and tonemapped (ACES fit) to a 4096 × 2048 WebP, plus a 64 × 32 blurred `_amb` copy for ambient light.

| File | Sky | Source asset | Authors | Notes |
|---|---|---|---|---|
| `storm_night.webp`, `storm_night_amb.webp` | Storm night | [Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) | Greg Zaal (Original), Jarod Guest (Sky edits) | partly cloudy day graded to night (day-for-night, the sun reads as the moon); lightning is drawn over it |
| `moonlit_overcast.webp`, `moonlit_overcast_amb.webp` | Moonlit overcast | [Kloppenheim 07 (Pure Sky)](https://polyhaven.com/a/kloppenheim_07_puresky) | Greg Zaal (Original), Jarod Guest (Sky edits) | — |
| `clear_starry.webp`, `clear_starry_amb.webp` | Clear starry night | [Rogland Clear Night](https://polyhaven.com/a/rogland_clear_night) | Greg Zaal (All) | full HDRI (not a pure-sky edit): its ground sits below the horizon, under the sea |
| `dusk_sea.webp`, `dusk_sea_amb.webp` | Dusk over the sea | [Qwantani Dusk 2 (Pure Sky)](https://polyhaven.com/a/qwantani_dusk_2_puresky) | Greg Zaal (Photography), Jarod Guest (Processing) | — |
| `fog_dawn.webp`, `fog_dawn_amb.webp` | Fog-bank dawn | [Kloofendal Misty Morning (Pure Sky)](https://polyhaven.com/a/kloofendal_misty_morning_puresky) | Greg Zaal (All) | misty morning graded cooler and darker |
| `squall.webp`, `squall_amb.webp` | Heavy squall | [Kloppenheim 01 (Pure Sky)](https://polyhaven.com/a/kloppenheim_01_puresky) | Greg Zaal (Original), Jarod Guest (Sky edits) | overcast dusk graded to a dark green-grey storm |

## Textures — `assets/textures/` (`tools/assets/textures.py`)

Source: [ambientCG](https://ambientcg.com) materials by Lennart Demes, licence **CC0 1.0** (https://docs.ambientcg.com/license/).
1K-JPG sets, resized to 1024 × 1024 WebP: `_color`, `_normal` (OpenGL) and, for cut-outs, `_opacity`.

| Files | Source asset | Used for |
|---|---|---|
| `tower_concrete_*.webp` | [Concrete034](https://ambientcg.com/view?id=Concrete034) | tower pillars and soffit |
| `stained_concrete_*.webp` | [Concrete042A](https://ambientcg.com/view?id=Concrete042A) | sea-stained pillar bases, dock walls |
| `rusted_steel_*.webp` | [Metal063](https://ambientcg.com/view?id=Metal063) | rusted hull plates, old dock steel |
| `corrugated_*.webp` | [CorrugatedSteel007A](https://ambientcg.com/view?id=CorrugatedSteel007A) | sheds, container sides |
| `catwalk_*.webp` | [MetalWalkway014](https://ambientcg.com/view?id=MetalWalkway014) | catwalk and gantry decks |
| `grate_*.webp` | [MetalWalkway001](https://ambientcg.com/view?id=MetalWalkway001) | floor grates over water |
| `wet_asphalt_*.webp` | [Asphalt025C](https://ambientcg.com/view?id=Asphalt025C) | dock roadway |
| `sea_rock_*.webp` | [Rock051](https://ambientcg.com/view?id=Rock051) | wet layered rock: channels and islets |
| `cliff_rock_*.webp` | [Rock058](https://ambientcg.com/view?id=Rock058) | cliffs, cave walls |
| `deck_plates_*.webp` | [MetalPlates006](https://ambientcg.com/view?id=MetalPlates006) | service-level floors, hatches |
| `painted_steel_*.webp` | [PaintedMetal004](https://ambientcg.com/view?id=PaintedMetal004) | CS red panels, railings, banner frames |
| `hazard_stripes_*.webp` | [PaintedMetal016](https://ambientcg.com/view?id=PaintedMetal016) | hazard edges on docks, lifts and cranes |
| `chainlink_*.webp` | [Fence007A](https://ambientcg.com/view?id=Fence007A) | fences (cut-out) |

## Sounds — `assets/sounds/` (`tools/assets/sounds.py`)

Source: [Freesound](https://freesound.org), **CC0 entries only** — each page is re-checked for the CC0 licence at build
time and refused otherwise. The high-quality MP3 preview is cut to at most 36 s with short fades, mono 96 kbps.

| File | Title | Author | Page | Used for |
|---|---|---|---|---|
| `rain_heavy.mp3` | Heavy_Rain_Loop.wav | Rubaoliva | https://freesound.org/people/Rubaoliva/sounds/624645/ | storm rain bed (loop) |
| `rain_night.mp3` | Rain at night medium.wav | jgxxx | https://freesound.org/people/jgxxx/sounds/704395/ | lighter night rain (loop) |
| `thunder.mp3` | Heavy Thunder Strike - no Rain - QUADRO.wav | BlueDelta | https://freesound.org/people/BlueDelta/sounds/446753/ | lightning strikes |
| `thunder_rain.mp3` | Rain and Thunder 4 | FlatHill | https://freesound.org/people/FlatHill/sounds/237729/ | distant storm bed |
| `surf_rocks.mp3` | Waves crashing on the rocks in Veracruz | felix.blume | https://freesound.org/people/felix.blume/sounds/411509/ | waves on the pillars and rocks (loop) |
| `wind_strong.mp3` | Strong Wind | florianreichelt | https://freesound.org/people/florianreichelt/sounds/459981/ | gusts on the upper platform (loop) |
| `metal_door.mp3` | FX_NOISY_METAL_DOOR_OPEN.wav | Olichite | https://freesound.org/people/Olichite/sounds/238891/ | hatches, heavy doors, metal creaks |
| `siren.mp3` | Air Raid Siren Alarm | Poligonstudio | https://freesound.org/people/Poligonstudio/sounds/412171/ | tower alarm |
| `siren_distant.mp3` | Sirens_in_The_Distance.wav | ivolipa | https://freesound.org/people/ivolipa/sounds/337099/ | far sirens across the water |
| `foghorn.mp3` | fog horn sample(wet).wav | kathol | https://freesound.org/people/kathol/sounds/37915/ | foghorn (wet) |
| `machinery.mp3` | Industrial Factory/Fans Loop | IanStarGem | https://freesound.org/people/IanStarGem/sounds/271096/ | service-level fans and machinery (loop) |
| `crane.mp3` | G16-09-Factory-Overhead Crane.wav | craigsmith | https://freesound.org/people/craigsmith/sounds/438133/ | overhead crane in the maintenance bay |
| `cave_drips.mp3` | Water Dripping in Cave.wav | Sclolex | https://freesound.org/people/Sclolex/sounds/177958/ | water channels: drips |
| `sea_cave.mp3` | Sea Cave | Andy_Gardner | https://freesound.org/people/Andy_Gardner/sounds/196713/ | water channels: sea cave swell |

## Not used

Anything CC-BY-NC, "free for personal use", or royalty-free packs whose licence forbids passing on the raw files.
