#!/bin/bash
# STEP -> GLB (tools/convert.py), then weld + simplify + meshopt
set -e
cd "$(dirname "$0")/.."
PYTHONPATH=.pylib ~/.venvs/eitri/bin/python tools/convert.py cad/RebotAssemblyV3.STEP /tmp/rebot_raw.glb tools/meta.json
npx gltf-transform weld /tmp/rebot_raw.glb /tmp/rebot_w.glb
npx gltf-transform simplify /tmp/rebot_w.glb /tmp/rebot_s.glb --ratio 0.4 --error 0.0008
npx gltf-transform meshopt /tmp/rebot_s.glb public/models/rebot.glb --level high
ls -la public/models
