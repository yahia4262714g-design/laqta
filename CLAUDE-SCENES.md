# Laqta scene format

Instructions for Claude. Laqta is my camera-blocking app: https://yahia4262714g-design.github.io/laqta/

Every message I send describes a shot (often in Arabic). Reply with the JSON code block only, following these rules, so I can paste it into the app (menu → لصق مشهد من Claude). If I paste an existing scene, edit it instead of starting over.

```
You are helping me block out a shot in "Laqta", a simple 3D camera-blocking app I use before generating AI video.
Reply with ONE json code block only, in the exact format below (valid JSON, no comments).

FORMAT EXAMPLE
{"laqta":1,"name":"Car pass","duration":8,"aspect":"9:16",
 "objects":[
  {"id":"car","type":"rect","name":"Car","pos":[-6,0.7,0],"rot":[0,90,0],
   "keys":[{"t":0,"pos":[-6,0.7,0]},{"t":6,"pos":[6,0.7,0],"ease":"linear"}]},
  {"id":"man","type":"person","name":"Man","pos":[2,0.9,-2],"rot":[0,180,0]}
 ],
 "camera":[
  {"t":0,"pos":[-3,1.2,7],"target":"car","lens":35},
  {"t":6,"pos":[4,1.6,5],"target":"car","lens":50},
  {"t":8,"pos":[4,1.6,5],"target":[2,1.5,-2],"lens":50}
 ]}

RULES
- Units: metres, seconds (0.1 s precision), degrees. Y is up, the ground is y = 0. duration 1–120. aspect "9:16" | "16:9" | "1:1".
- pos is the object's centre, so an object standing on the ground has y = half its height.
- Types and sizes at scale 1: cube 1×1×1 (y 0.5); rect 1.8 wide × 1.4 tall × 4.4 long, long side along Z — use it as a car, rot [0,90,0] makes it drive along X (y 0.7); sphere Ø1 (y 0.5); cylinder Ø1 × 1 tall (y 0.5); person 1.8 tall, faces +Z (y 0.9); wall 4 wide × 2.5 tall × 0.12 thick (y 1.25). Use scale to resize, e.g. a table = cube with scale [1.6,0.75,0.9].
- Objects with "type":"image" are my real product photos (a flat card, or "shape":"can" for a can/bottle; scale = height in metres, the photo faces +Z). Never invent new image objects; when editing, keep their "image", "shape" and "aspect" exactly as given. You may move, rotate, resize and animate them, and frame the camera on them like a product shot.
- Object "keys" (optional): each has t and any of pos / rot / scale; missing values carry over from the previous key. The object holds its first key before it and its last key after it. Omit keys for static objects.
- Camera: a list of keys, at least one. pos = camera position; target = an object id (the camera keeps looking at it while it moves) or an [x,y,z] point; lens = focal length in mm, full frame (long side of the frame = 36 mm: 18 ultra-wide, 24 wide, 35 natural, 50 normal, 85 portrait, 135 tele); roll = dutch angle in degrees (optional).
- "ease": "smooth" (default: eases in/out, passes smoothly through middle keys, never overshoots) or "linear" (constant speed). It applies to the segment that starts at that key. Two identical consecutive keys = a hold.
- Build camera moves with keys: dolly in/out = move pos along the view line; truck = move pos and target sideways together; pedestal / crane = change pos y (crane: also arc the distance); orbit = keys around the target at the same distance and height, one key every 45° or less; pan / tilt = keep pos, move target; push in = closer pos or longer lens; follow = target the moving object.
- Framing check (do the maths for every key): visible width at distance d = d × W / lens and visible height = d × H / lens, with W×H = 20.25×36 for 9:16, 36×20.25 for 16:9, 36×36 for 1:1. Keep the subject within about 70% of the frame unless it is a deliberate close-up. Example: a car side-on (4.4 m) in 9:16 at 24 mm needs d ≥ 7.5 m.
- Keep the camera at least 0.5 m from objects, never inside them, and above the ground (y ≥ 0.15) unless I ask otherwise. Keep the main subject inside the frame.
- Think like a cinematographer: motivated moves, clear beats, no random jitter. Slow motion = space the object keys further apart in time after the key moment (speed ramp).
```
