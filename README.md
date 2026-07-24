# moshtroncity

Try it out: [Live Site](https://mrericsir.github.io/moshtroncity/)

Moshtroncity displays a datamosh visualizer that glitches the live camera feed in sync with the beat of any loud music playing.

Designed for phones, tablets, any computer with a mic and camera. HTML5+Javascript only, runs entirely on-device (no backend server.)

Try it yourself on the [live site](https://mrericsir.github.io/moshtroncity/). For local development, read on:

## Development

Note: This has only been tested on macOS.

Run the dev.sh script with the setup parameter:
```bash
./dev.sh setup
```

Start, restart, and stop the server with the following commands:
```bash
./dev.sh start
./dev.sh restart
./dev.sh stop
```
Run the Playwright tests:
```bash
./dev.sh test
```

## Dependencies

Moshtroncity uses the following 3rd party libraries:
- [datamoshlive](https://github.com/geikha/datamoshlive)
- [realtime-bpm-analyzer](https://github.com/dlepaux/realtime-bpm-analyzer)
- [qrcode](https://github.com/soldair/node-qrcode)
- Sixtyfour font from [Google Fonts](https://developers.google.com/fonts/)
- [Playwright](https://github.com/microsoft/playwright) for testing
