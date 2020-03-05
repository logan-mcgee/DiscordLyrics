# DiscordLyrics
Use MusixMatch API to sync spotify song lyrics to Discord Status

oh yeah tbf its prob deffo against ToS like so its not really my fault so yeah glhf

## How to use?
1. Install [Node.js](https://nodejs.org/en/)
2. cd into the directory and use `npm i`
3. Head to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/applications) and create an application.
4. Make sure your `redirect_uri` is set to `http://127.0.0.1:3000/authorize` unless changed in the config.json.
5. Copy the `client_id` and `client_secret` and place them in the config.json under `SpotifyApi`
6. Leave `MusixMatch` info unless using your own account (will need to use Fiddler and capture the requests)
8. Leave `DiscordToken` as is (or blank) if you want to use the built in token grabbber (means you wont ever have to replace the token). Otherwise grab your token from `CTRL + Shift + i` in the client and taking it from a request header.
9. Use `node DiscordLyrics.js` to start up the program and follow the steps for first time use. 
10. After first time setup every time you start it up after will not require you to visit a webpage.
