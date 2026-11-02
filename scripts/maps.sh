#!/bin/bash
# usage: scripts/maps.sh "<solution substring>" j1 j2 j3 ...
S=/tmp/claude-0/-home-user-ERODE/2466b3a5-b813-5e09-9140-cf9cec064fc8/scratchpad
name="$1"; shift
files=()
for j in "$@"; do
  npx tsx scripts/mapdump.ts "$name@$j" $S/m_$j.json >/dev/null && python3 scripts/mapimg.py $S/m_$j.json $S/m_$j.png && files+=($S/m_$j.png)
done
python3 - "${files[@]}" <<'PY'
import sys
from PIL import Image
ims=[Image.open(f) for f in sys.argv[1:]]
ims=[i.crop((0, int(i.height*0.33), i.width, i.height)) for i in ims]
w=sum(i.width for i in ims); h=max(i.height for i in ims)
out=Image.new('RGB',(w,h))
x=0
for i in ims: out.paste(i,(x,0)); x+=i.width
out=out.resize((w*2//3, h*2//3))
out.save('/tmp/claude-0/-home-user-ERODE/2466b3a5-b813-5e09-9140-cf9cec064fc8/scratchpad/maps.png')
PY
