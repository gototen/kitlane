# Meeting time finder (`kit/meet`)

A small Preact tool that exists to test one specific claim from the Kitlane
specification (section 4.7): someone can **adapt a tool from its published
files alone**, even when those files are a bundled, minified artifact.

- `src/` holds the readable source. It is intentionally **not** published.
- `dist/` holds what Kitlane serves: `index.html`, a minified ES module
  `app.js` (Preact plus the app), and a minified `app.css`. `dist/` is
  gitignored and produced by the build.

## Build

```sh
npm run build -w examples/tz-minified
```

## Publish

```sh
npx kitlane publish examples/tz-minified/dist --name meet
```

`kitlane.json` in this folder records the name, title, purpose, tags, and the
`./dist` deploy path so the CLI can fill them in.

## Adaptation test

1. In the portal, open the tool's detail page and choose **Make a copy**, or
   run `npx kitlane copy meet --name meet-mine`.
2. Download the copy's files (`npx kitlane pull meet-mine ./meet-mine`).
3. Ask your preferred agent or builder to make a change using only the
   downloaded `index.html`, `app.js`, and `app.css` (for example: add a city,
   change the working-hours window, or add a dark-mode toggle).
4. Republish: `npx kitlane publish ./meet-mine --name meet-mine`.

The source repository, build project, and prompt history are not required.
Record what the agent could and could not infer; that is the evidence the
specification asks for.

## Notes

- Assets are referenced relatively (`./app.js`, `./app.css`) because the
  shell pins pages under `/_releases/<version>/`. The SDK at
  `/._kitlane/sdk.js` is the one allowed root-absolute URL.
- Favourite cities are stored in Kitlane personal storage
  (`kitlane.user.collection("cities")`), so they follow the user across
  devices and are isolated per tool and per user.
