# Parkline

Parkline is a mobile-responsive 3D parking game with ten introductory trials, an endless mode, five camera views, and locally saved progress. It uses Next.js, strict TypeScript, and Three.js.

Run with Node.js 22 or later.

```sh
npm ci
npm run dev
```

Open http://localhost:3000 and select a level on the entry screen. Open Pause and choose Levels to return to the selector. The models ship with the project.

- In the Garage, open the car picker to browse 38 drivable models, including all 33 cars in Different Cars Pack. Available paint and roof settings are saved separately for each car.
- Open the three-dot button in the upper right to view keyboard shortcuts and asset credits.
- Keyboard: hold W to accelerate, A and D to steer, S to reverse in Drive, and Space to brake. F switches between Drive and Reverse, C changes the camera, and Esc opens the pause menu. Arrow keys also work.
- Touch: drag the right-hand steering wheel and use the left-hand pedals. Drag the vertical shift lever or tap P, R, N or D. Steering and acceleration can be used simultaneously.
- Rotate a phone during a trial, including in fullscreen. The map and controls reflow between portrait and landscape, and held inputs release on rotation while the trial, gear, and camera stay in place.
- Use the fullscreen button in the top-right controls to expand the game. Browsers that restrict native fullscreen get a layout that fills the available browser viewport.
- The yellow arrow marks the target bay. The lot’s hoardings show a live rear camera. Tap Rear view or press V to see behind the bumper on the full playfield, then tap or press it again to return to your previous camera.
- Stop fully inside the highlighted bay to earn three stars and unlock the next trial. Either parking direction counts once the car is aligned and at rest. The first contact with a wall, parked car or barrier ends the trial and opens Impact Cam. The orange ring marks the contact point. Retry resets the car and controls.
- Clear trial 10 to unlock endless parking. Endless trials progress from two parking stops to four, with offset approaches, tighter gates, and narrower bays. The simulator verifies a route with extra clearance before offering each course.
- Tap Enable sound to play a test cue and start audio on browsers that require an explicit tap. Engine revs respond to speed and throttle. The speaker button mutes or unmutes the mix, and the setting persists across reloads.

```sh
npm run check
npm test
npm run build
npm start
```

[Asset sources and licenses](public/credits.txt)

## Android updates

`npm run android` builds the APK in `public/download/parkline.apk`. Install version 1.1 once over the previous APK signed with the same Android key to keep local progress. It runs in fullscreen and follows Android's rotation setting.

Publish web game changes as signed live updates. Choose a build number higher than all previous releases for this Android version:

```sh
npm run android:update -- 4
```

The command writes a signed ZIP and manifest to `android/app/build/outputs/live-updates/4`. Android packages use the bundled Lilita One font. On the signing machine, the private key defaults to `%LOCALAPPDATA%/Parkline/android-live-update-private.pem` on Windows. Set `PARKLINE_UPDATE_KEY_FILE` to use a private key stored elsewhere. Keep a secure backup of the key.

Host both files as public assets of the GitHub release tagged `android-live`. For subsequent updates, upload the numbered ZIP first, then replace `parkline-android-v2.json` with the new manifest. The installed app checks this feed on startup, downloads in the background, and applies the update the next time it starts. Controls, models, maps, and other web game changes can use this channel. Changes to Android code or native plugins require a new APK and version code.

For a personal build with the supplied Game Paused DEMO font, place the original OTF at `public/fonts/game-paused-demo.otf` before starting the server. The source archive uses Lilita One when the demo font is absent.
