# Bug triage

12 reports from `triage-samples`, most severe first (score 0 cosmetic … 3 crash). Suggested check at 0.3; same problem at 0.6.

| severity | area | report | what happened | would be caught by | same problem as |
|---|---|---|---|---|---|
| crash/blocker (3.0) | save | r03-load-freeze.txt | I clicked Load a city file on the title screen, picked my save, and it froze on the loading screen forever. Ha | savetest (0.93) | — |
| crash/blocker (3.0) | crash | r09-grid-undo-crash.txt | I laid a street grid, hit Undo, and the game froze with a red Something broke message. | gridtest (0.54) | — |
| workaround (1.7) | transit | r07-route-deleted.txt | Deleted one road and my bus route got wiped out, every stop on it vanished even the ones miles away. | playtest5 (0.92) | r01-bus-line-gone.txt |
| workaround (1.6) | performance | r05-rain-fps.txt | When it rains in my big city the frame rate drops to like 10 and the camera is really laggy. Fine when it's su | — | — |
| workaround (1.5) | transit | r01-bus-line-gone.txt | I bulldozed a little side street and my whole bus line (69 Express) disappeared. All the stops are gone and th | playtest5 (0.96) | — |
| workaround (1.2) | services | r04-overlaps-road.txt | Trying to place the fire station and it just says Overlaps a road in red. I moved it around for a while and di | learnability (0.91) | — |
| workaround (1.1) | visuals | r06-rain-year.txt | It has been raining since June 2030 and it's now February 2032. Also it snowed in July. | weathertest (1.00) | — |
| workaround (1.0) | roads | r08-stadium-nothing.txt | Built the Slop 69 Field stadium, it says built, but nothing happens. No fans, no traffic, land value didn't go | linktest (0.98) | — |
| cosmetic (0.3) | feed | r12-feed-spam.txt | THERE IS TOO MANY POSTS ON THE FAKE SOCIAL. It posts every couple seconds, I can't read any of it. | feedtest (0.43) | — |
| cosmetic (0.2) | transit | r10-trains.txt | Would be cool to have trains, like a freight line through the county. | — | — |
| cosmetic (0.0) | visuals | r11-square-trees.txt | The trees in the distance are square boxes, not trees. Ultra settings. | starttest (0.80) | r02-far-trees-cards.txt |
| cosmetic (0.0) | visuals | r02-far-trees-cards.txt | On Ultra the trees far away look like flat green and grey rectangles on sticks. Close up they're fine. | treelod (0.54) | — |

## Agreement with labels.json: area 12/12 · severity 11/12 exact, 12/12 within one level · check 10/12 · duplicates: 2 found, 0 missed, 0 false

- check r04-overlaps-road.txt: learnability (label placetest/svcstatus/tiptest)
- severity r06-rain-year.txt: workaround (label cosmetic)
- check r12-feed-spam.txt: feedtest (label linktest)
