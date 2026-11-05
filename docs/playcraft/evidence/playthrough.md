# ROCKSLIDE playthrough: PASS

2026-11-05T13:24:34.648Z · http://localhost:4173/ · 487 s · 84 checks · 59 real key inputs (19 holds) · 31 clicks · 125 travel shortcuts · 2 callout-timer shortcuts

Method: Real key input and clicks for every action and menu; long journeys skipped with the QA teleport (counted in counts.travelShortcuts); the radio callout timer wound down through the save (counts.timerShortcuts). Chromium headless, SwiftShader (software WebGL), 390x844 touch viewport, Light graphics.

## Missions

| Mission | Funds | Reputation | Rank after | Wall time |
|---|---|---|---|---|
| Morning Rounds | +150 | +120 | Recruit | 21 s |
| Eyes on Kessel Bowl | +220 | +160 | Patroller | 46 s |
| Controlled Release | +340 | +260 | Senior patroller | 107 s |
| Lost on the Tannberg | +380 | +300 | Senior patroller | 75 s |
| Firewood for the Kettle | +160 | +110 | Lead patroller | 9 s |
| Where's Pepper? | +140 | +120 | Lead patroller | 60 s |
| Tree Down on the Pass | +90 | +70 | Lead patroller | 5 s |
| Stuck in the Drift | +90 | +70 | Lead patroller | 5 s |

Final: Lead patroller, 1170 funds, 1225 reputation, day 2, 1 of 10 badges, buildings: workshop.

## Checks

| | Area | Check | Detail |
|---|---|---|---|
| ✅ | Title | title screen offers a fresh start |  |
| ✅ | Title | Start your patrol begins play in the lodge | {"mode":"foot","funds":60} |
| ✅ | Settings | pause menu opens with Esc and closes with Back to patrol |  |
| ✅ | Title | the first radio call says where to start (the mission table) | DispatchMorning, Kessel Patrol. Forty centimetres up high overnight. There is a call on yo |
| ✅ | Morning Rounds | the mission table opens from the lodge table |  |
| ✅ | Morning Rounds | call taken from the mission table | {"id":"rounds","title":"Morning Rounds","step":0,"steps":5,"stepKind":"interact","objective":"Say good morning to Koda","seconds":0.1} |
| ✅ | Morning Rounds | step 1: pet Koda |  |
| ✅ | Morning Rounds | step 2: get on the sled in the garage |  |
| ✅ | Morning Rounds | the sled drives under real throttle (W) | {"speedKmh":19.3,"movedM":3.1} |
| ✅ | Morning Rounds | step 3: ride up the pass road to the weather station |  |
| ✅ | Morning Rounds | X gets off the sled |  |
| ✅ | Morning Rounds | step 4: hold Repair for 3 s to restart the weather station |  |
| ✅ | Morning Rounds | mission completes and the debrief opens | DoneMorning RoundsStation is transmitting again. Thanks. Fresh numbers: forty centimetres overnight up there.+150funds+1 |
| ✅ | Morning Rounds | pays the advertised reward (+150 funds, +120 reputation) | {"funds":150,"reputation":120} |
| ✅ | Eyes on Kessel Bowl | the mission table opens from the lodge table |  |
| ✅ | Eyes on Kessel Bowl | call taken from the mission table | {"id":"survey","title":"Eyes on Kessel Bowl","step":0,"steps":4,"stepKind":"mount","objective":"Start the helicopter on the pad","seconds":0.1} |
| ✅ | Eyes on Kessel Bowl | step 1: start the helicopter on the pad |  |
| ✅ | Eyes on Kessel Bowl | R lifts the helicopter off once the rotor is up to speed | {"agl":4.1,"rotor":0.974} |
| ✅ | Eyes on Kessel Bowl | step 2: fly to Kessel Bowl |  |
| ✅ | Eyes on Kessel Bowl | step 3: the scanner reads all four slopes (A and C loaded, B and D stable) | {"SLOPE A":"loaded","SLOPE B":"stable","SLOPE C":"loaded","SLOPE D":"stable"} |
| ✅ | Eyes on Kessel Bowl | C settles the helicopter onto the pad | {"landed":true} |
| ✅ | Eyes on Kessel Bowl | mission completes and the debrief opens | DoneEyes on Kessel BowlReport filed. Slopes A and C are loaded. We bring them down tomorrow, or today if you are up for  |
| ✅ | Eyes on Kessel Bowl | pays the advertised reward (+220 funds, +160 reputation) | {"funds":220,"reputation":160} |
| ✅ | Eyes on Kessel Bowl | X shuts the helicopter down on the pad and you climb out | {"mode":"foot"} |
| ✅ | Controlled Release | the mission table opens from the lodge table |  |
| ✅ | Controlled Release | call taken from the mission table | {"id":"release","title":"Controlled Release","step":0,"steps":7,"stepKind":"interact","objective":"Take the charges from the locker in the garage","seconds":0.2 |
| ✅ | Controlled Release | step 1: take the charges from the locker |  |
| ✅ | Controlled Release | step 2: close the pass road at the barrier |  |
| ✅ | Controlled Release | step 3: climb to Kessel Ridge |  |
| ✅ | Controlled Release | step 4: set a charge on each loaded slope (A and C) |  |
| ✅ | Controlled Release | firing is refused while standing on the slope ("Too close to fire", disabled) | {"label":"Too close to fire","hold":0,"enabled":false} |
| ✅ | Controlled Release | step 5: fire the charges from safe ground (hold Fire charges) | {"fromRunTime":7.3} |
| ✅ | Controlled Release | hit-stop: the world clock nearly stops on the blast, then recovers | {"worldSecondsPerFrame":[0.003,0.0095,0.0197,0.0284,0.0356,0.0414,0.0457,0.0485]} |
| ✅ | Controlled Release | the blast asks the phone to vibrate (pattern 45/50/90 ms) | [[16,70,16],[16,70,16],[45,50,90]] |
| ✅ | Controlled Release | step 6: the avalanche runs and settles | {"releasedShare":0.945,"reachedRoad":false} |
| ✅ | Controlled Release | a release on the loaded slopes brings most of the loaded snow down | {"releasedShare":0.945} |
| ✅ | Controlled Release | mission completes and the debrief opens | DoneControlled ReleaseClean release, the berm held, the road is open. That is how it is done.95% of the loaded snow came |
| ✅ | Controlled Release | pays the advertised reward (+340 funds, +260 reputation) | {"funds":340,"reputation":260} |
| ✅ | Station and gear | build the garage workshop from the mission table (220 funds) | {"buildings":["workshop"],"spent":220,"rank":"Senior patroller"} |
| ✅ | Station and gear | buy the Mountain 800 engine at the workbench and it is fitted | {"equipped":"engine-800"} |
| ✅ | Station and gear | the engine upgrade really is faster: speed after 60 m from a standstill on a flat packed road | {"stock":[{"kmh":60.3,"why":"sled, 60 m, engine-stock"},{"kmh":60.2,"why":"sled, 60 m, engine-stock"}],"mountain800":[{"kmh":66.6,"why":"sled, 60 m, engine-800" |
| ✅ | Lost on the Tannberg | the mission table opens from the lodge table |  |
| ✅ | Lost on the Tannberg | call taken from the mission table | {"id":"skier","title":"Lost on the Tannberg","step":0,"steps":6,"stepKind":"goto","objective":"Get to the Tannberg top station: up the run on the sled, or fly", |
| ✅ | Lost on the Tannberg | step 1: get to the Tannberg top station |  |
| ✅ | Lost on the Tannberg | Koda takes the scent and leads to the subject | {"kodaSamples":63,"endsFrom":7} |
| ✅ | Lost on the Tannberg | Koda's route follows the scent trail once on it (within 12 m) | {"worstOffTrailM":1.4,"worstIncludingTheRunToTheTrailM":1.4} |
| ✅ | Lost on the Tannberg | step 3: hold First aid for 3 s |  |
| ✅ | Lost on the Tannberg | step 4: bring the sled over and help Nils on |  |
| ✅ | Lost on the Tannberg | step 5: take Nils down to the clinic on the sled |  |
| ✅ | Lost on the Tannberg | mission completes and the debrief opens | DoneLost on the TannbergNils is warm, splinted and eating soup. He says Koda is the best dog he has ever met.+380funds+3 |
| ✅ | Lost on the Tannberg | pays the advertised reward (+380 funds, +300 reputation) | {"funds":380,"reputation":300} |
| ✅ | Firewood for the Kettle | the mission table opens from the lodge table |  |
| ✅ | Firewood for the Kettle | call taken from the mission table | {"id":"supplies","title":"Firewood for the Kettle","step":0,"steps":4,"stepKind":"interact","objective":"Load the supply crate onto the sled rack","seconds":0.2 |
| ✅ | Firewood for the Kettle | step 1: load the crate onto the sled rack |  |
| ✅ | Firewood for the Kettle | step 2: get on the sled |  |
| ✅ | Firewood for the Kettle | step 3: ride down to the Kettle |  |
| ✅ | Firewood for the Kettle | mission completes and the debrief opens | DoneFirewood for the KettleThat's the stove sorted for a week. Come in for a hot chocolate any time.+160funds+110reputat |
| ✅ | Firewood for the Kettle | pays the advertised reward (+160 funds, +110 reputation) | {"funds":160,"reputation":110} |
| ✅ | Where's Pepper? | the mission table opens from the lodge table |  |
| ✅ | Where's Pepper? | call taken from the mission table | {"id":"pepper","title":"Where's Pepper?","step":0,"steps":5,"stepKind":"goto","objective":"Go to Mirror Lake","seconds":0.1} |
| ✅ | Where's Pepper? | step 1: go to Mirror Lake |  |
| ✅ | Save and Continue | after a reload, Continue restores the mission mid-way, funds, rank and place | {"mission":"pepper step 1","funds":810,"rank":"Lead patroller"} |
| ✅ | Where's Pepper? | Koda takes the scent and leads to the subject | {"kodaSamples":48,"endsFrom":6} |
| ✅ | Where's Pepper? | Koda's route follows the scent trail once on it (within 12 m) | {"worstOffTrailM":3.9,"worstIncludingTheRunToTheTrailM":8.4} |
| ✅ | Where's Pepper? | step 3: coax Pepper down and pick her up |  |
| ✅ | Where's Pepper? | step 4: bring Pepper home to the Kettle |  |
| ✅ | Where's Pepper? | mission completes and the debrief opens | DoneWhere's Pepper?Pepper is on the windowsill pretending none of this happened.+140funds+120reputationBack to patrol |
| ✅ | Where's Pepper? | pays the advertised reward (+140 funds, +120 reputation) | {"funds":140,"reputation":120} |
| ✅ | Callouts | a radio callout comes in on the game's timer (#1) | Incoming callTree Down on the PassA spruce has come down across the pass road below Kessel |
| ✅ | Tree Down on the Pass | step 1: get to the scene |  |
| ✅ | Tree Down on the Pass | mission completes and the debrief opens | DoneTree Down on the PassPass road clear. Thanks for the quick work.+90funds+70reputationBack to patrol |
| ✅ | Tree Down on the Pass | pays the advertised reward (+90 funds, +70 reputation) | {"funds":90,"reputation":70} |
| ✅ | Callouts | a radio callout comes in on the game's timer (#2) | Incoming callStuck in the DriftA van has slid into a drift on the Tannberg road.RespondLat |
| ✅ | Stuck in the Drift | step 1: get to the scene |  |
| ✅ | Stuck in the Drift | mission completes and the debrief opens | DoneStuck in the DriftVan is back on the road. The driver waved. Mostly.+90funds+70reputationBack to patrol |
| ✅ | Stuck in the Drift | pays the advertised reward (+90 funds, +70 reputation) | {"funds":90,"reputation":70} |
| ✅ | Callouts | callouts are drawn from the pool (both kinds answered, or one twice) | ["tree","drift"] |
| ✅ | Badges and Koda | Koda smells a hidden badge from 20 m and runs to it | {"kodaFromBadgeM":5.9,"mode":"point"} |
| ✅ | Badges and Koda | walking onto it finds the badge and it is logged | {"badges":"1 of 10"} |
| ✅ | Sleep | the bunk ends the day: next morning, a fresh four-period forecast | {"day":2,"forecast":"MorningOvercast-6°MiddayOvercast-8°AfternoonOvercast-8°EveningOvercast-11°"} |
| ✅ | Campaign | every story mission completed end to end | ["rounds","survey","release","skier","supplies","pepper","tree","drift"] |
| ✅ | Campaign | reputation raises the rank (Recruit at the start) | {"rank":"Lead patroller","reputation":1225,"ranks":"Recruit 0, Patroller 200, Senior patroller 520, Lead patroller 950, Chief of patrol 1500"} |
| ✅ | Campaign | every mission step's objective is on the HUD, word for word (plus its count on counted steps) | {"stepsChecked":24,"mismatches":[]} |
| ✅ | Campaign | no page errors or console errors during the whole playthrough | [] |

## Not tested here

- real-device frame rate
- real touch hardware and haptics on a phone (vibration was observed as a request to navigator.vibrate, not felt)
- iPhone Safari (this is Chromium)
- driving and flying the long journeys by hand
