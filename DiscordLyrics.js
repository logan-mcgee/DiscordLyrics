const requestup = require("request");
const {promisify} = require("util");
const config = require("./config.json");
const fs = require("fs");
const express = require("express");
const app = express();
const request = promisify(requestup);

let TokenCheck;
console.log("Checking if spotify token exists...");

try {
	TokenCheck = require("./token.json");
} catch (e) {
	fs.writeFileSync(__dirname + "/token.json", JSON.stringify({
		AccessToken: "",
		RefreshToken: ""
	}));
	console.error("Token.json was not found.\nRestart program to proceed.\n")
	process.exit();
}

let SpotifyToken = GetSpotifyToken();
let SongSeconds;
let ExpressServer;
let SpotifyBase64 = new Buffer(`${config.SpotifyApi.client_id}:${config.SpotifyApi.client_secret}`).toString("base64");
let CurrentURI = "";
let IsPaused = false;

app.get("/authorize", async (req, res) => {
	if (req.query.code) {
		let Tokens = await request({
			url: `https://accounts.spotify.com/api/token`,
			method: "POST",
			form: {
				grant_type: "authorization_code",
				code: req.query.code,
				redirect_uri: config.SpotifyApi.redirect_uri
			},
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				"Authorization": "Basic " + SpotifyBase64
			}
		});
		let TokenData = JSON.parse(Tokens.body);
		let AccessToken = TokenData.access_token;
		let RefreshToken = TokenData.refresh_token;

		fs.writeFileSync(__dirname + "/token.json", JSON.stringify({
			AccessToken: AccessToken,
			RefreshToken: RefreshToken
		}));

		CheckForChange();
		ExpressServer.close();
		console.log("Got token, killing server.");
	}
	res.send("Authorizing.");
});


if (TokenCheck.CurrentToken == ("" || null) || TokenCheck.RefreshToken == ("" || null)) {
	console.log(`Please visit:\nhttps://accounts.spotify.com/authorize?response_type=code&client_id=${config.SpotifyApi.client_id}&scope=user-read-playback-state&redirect_uri=${config.SpotifyApi.redirect_uri}\n`);
	ExpressServer = app.listen(config.callback_port);
} else {
	console.log("Token found, skipping authentication\n");
	CheckForChange();
}

TokenCheck = null;

function GetSpotifyToken() {
	let TokenData = JSON.parse(fs.readFileSync(__dirname + "/token.json"));
	return TokenData.AccessToken;
}

function GetSpotifyRefreshToken() {
	let TokenData = JSON.parse(fs.readFileSync(__dirname + "/token.json"));
	return TokenData.RefreshToken;
}

async function RefreshToken() { 
	let RT = GetSpotifyRefreshToken();
	let Tokens = await request({
		url: `https://accounts.spotify.com/api/token`,
		method: "POST",
		form: {
			grant_type: "refresh_token",
			refresh_token: RT
		},
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			"Authorization": "Basic " + SpotifyBase64
		}
	});

	let TokenData = JSON.parse(Tokens.body);
	let AccessToken = TokenData.access_token;

	fs.writeFileSync(__dirname + "/token.json", JSON.stringify({
		AccessToken: AccessToken,
		RefreshToken: RT
	}));
}

let DiscordToken = config.DiscordToken;

if (DiscordToken === ("optional!" || "" || null)) {
	const WebSocket = require("ws");

	const ws = new WebSocket("ws://localhost:6463/?v=1", {
		origin: "https://discordapp.com"
	});

	ws.on("message", async (msg) => {
		const data = JSON.parse(msg);
		
		switch (data.cmd) {
			case "DISPATCH":
				if (data.evt === "READY") {
					ws.send(JSON.stringify({
						cmd: "SUBSCRIBE",
						args: {},
						evt: "OVERLAY",
						nonce: "auth_one"
					}));
					
					ws.send(JSON.stringify({
						cmd: "OVERLAY",
						args: {
							type: "CONNECT",
							pid: -1
						},
						nonce: "auth_two"
					}));
				} 
				else if (data.evt === "OVERLAY") {
					const proxyEvent = data.data;
					
					if (proxyEvent.type === 'DISPATCH' && proxyEvent.payloads) {
						for (const payload of proxyEvent.payloads) {
							if (payload.type === "OVERLAY_INITIALIZE") {
								console.log("Stole discord token. Token: " + payload.token);
								DiscordToken = payload.token;
							}
						}
					}
				}
				
				break;
		}
	});
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function SetStatus(status) {
	request({method: "PATCH", url: "https://discordapp.com/api/v6/users/@me/settings", body:JSON.stringify({
		custom_status: {
			text: status,
		}
	}), headers: {Authorization: DiscordToken, "Content-Type": "application/json"}});
}

async function CheckForChange() {
	try {
		let res = await request({
			url: "https://api.spotify.com/v1/me/player/currently-playing?market=GB",
			headers: {
				Authorization: "Bearer " + SpotifyToken
			}
		});
		IsPaused = res.statusCode == 204 ? true : false;
		if (!IsPaused) {
			let data = JSON.parse(res.body);
			let songdata = data.item;

			IsPaused = !data.is_playing;

			if (CurrentURI != data.item.uri && !IsPaused) {
				CurrentURI = data.item.uri;

				let artists = [];
				for (let artistIndex in songdata.artists) {
					let artist = songdata.artists[artistIndex];
					artists.push(artist.name);
				}

				console.log(`\nNew Song Info: \n  - Song: ${songdata.name}\n  - Artist: ${artists.join(",")}\n  - Album: ${songdata.album.name}\n  - SID: ${CurrentURI}\n`);
				SetStatus("Song lyrics loading...");
				TriggerSongPlaying();
			}
		}
	}
	catch(e) {
		console.log(`Token gone invalid, regenerating`);
		await RefreshToken();
		SpotifyToken = GetSpotifyToken();
		CheckForChange();
		return;
	}
	if (DiscordToken == "") {
		console.log("Token not grabbed yet. Waiting...");
		CheckForChange();
		return;
	}
	setTimeout(CheckForChange, config.song_refresh);
}



async function beginResync() {
	let syncres = await request({
		url: "https://api.spotify.com/v1/me/player/currently-playing?market=GB",
		headers: {
			Authorization: "Bearer " + SpotifyToken
		}
	});
	let syncdata = JSON.parse(syncres.body);
	SongSeconds = syncdata.progress_ms / 1000;
	console.log("Performed resync");
}

async function TriggerSongPlaying() {
	let res = await request({
		url: "https://api.spotify.com/v1/me/player/currently-playing?market=GB",
		headers: {
			Authorization: "Bearer " + SpotifyToken
		}
	});
	let data = JSON.parse(res.body);
	let songdata = data.item;

	let artists = [];
	for (let artistIndex in songdata.artists) {
		let artist = songdata.artists[artistIndex];
		artists.push(artist.name);
	}

	let query = {
		"format": "json",
		"q_track": songdata.name,
		"q_artist": songdata.artists[0].name,
		"q_artists": artists.join(","),
		"q_album": songdata.album.name,
		"user_language": "en",
		"q_duration": songdata.duration_ms / 1000,
		"tags": "nowplaying",
		"namespace": "lyrics_synched",
		"part": "lyrics_crowd,user,lyrics_verified_by",
		"track_spotify_id": songdata.uri,
		"f_subtitle_length_max_deviation": "1",
		"subtitle_format": "mxm",
		"usertoken": config.MusixMatch.usertoken,
		"signature": config.MusixMatch.signature,
		"signature_protocol": "sha1",
		"app_id": "web-desktop-app-v1.0"
	};

	let lyrres = await request({
		url: `https://apic-desktop.musixmatch.com/ws/1.1/macro.subtitles.get`,
		qs: query,
		headers: {
			Cookie: config.MusixMatch.Cookie
		}
	});

	try {
		let lyricres = JSON.parse(lyrres.body);
		let lyricsarr = JSON.parse(lyricres.message.body.macro_calls["track.subtitles.get"].message.body.subtitle_list[0].subtitle.subtitle_body);
		
		let lyrics = {};
		for (let lyricIndex in lyricsarr) {
			lyrics[lyricsarr[lyricIndex].time.total] = lyricsarr[lyricIndex].text;
		}

		let lateres = await request({
			url: "https://api.spotify.com/v1/me/player/currently-playing?market=GB",
			headers: {
				Authorization: "Bearer " + SpotifyToken
			}
		});
		let latedata = JSON.parse(lateres.body);

		let resyncClock = setInterval(beginResync, config.resync_time);
		SetStatus(null);

		for (SongSeconds = latedata.progress_ms / 1000; SongSeconds < latedata.item.duration_ms / 1000; SongSeconds += 0.01) {
			await sleep(10);

			if (CurrentURI != latedata.item.uri) {
				clearInterval(resyncClock);
				SetStatus(null);
				return;
			}

			if (lyrics[SongSeconds.toFixed(2)] != undefined) {
				console.log(`${SongSeconds.toFixed(2)} : ${lyrics[SongSeconds.toFixed(2)]}`);
				SetStatus(lyrics[SongSeconds.toFixed(2)]);
			}

			if (IsPaused) {
				CurrentURI = "";
				clearInterval(resyncClock);
				SetStatus("Player Paused.");
				setTimeout(() => {
					SetStatus(null);
				}, 5000);
				console.log("Player paused. Ending.");
				return;
			}

		}
		CurrentURI = "";
		clearInterval(resyncClock);
	} catch (e) {
		SetStatus("Lyrics not found.");
		setTimeout(() => {
			SetStatus(null);
		}, 5000);
		console.log("Song not found. Error:\n" + e);
		return;
	}
	return;
}
