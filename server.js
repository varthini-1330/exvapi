require('dotenv').config();
const WebSocket = require('ws');
const fs = require('fs');
const axios = require('axios');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const wss = new WebSocket.Server({ port: 5001 });
console.log("✅ WebSocket server listening on ws://localhost:5001");

wss.on('connection', (ws) => {
    console.log('🔗 New Vapi connection established');
    let streamSid = uuidv4();
    let chunkCounter = 0;

    ws.on('message', async (msg, isBinary) => {
        if (!isBinary) {
            const data = JSON.parse(msg);
            const event = data.event;

            switch (event) {
                case 'connected':
                    console.log('🟢 Vapi connected');
                    break;
                case 'start':
                    streamSid = data.stream_sid || uuidv4();
                    console.log('🚀 Stream started:', streamSid);
                    break;
                case 'stop':
                    console.log('🛑 Stream stopped:', streamSid);
                    break;
                case 'dtmf':
                    console.log('📞 DTMF received:', data.dtmf);
                    break;
                default:
                    console.log('📨 Unknown event:', data);
            }
            return;
        }

        const responseText = "Hi, how can I assist you today?";

        try {
            const ttsRes = await axios.post(
                `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}/stream`,
                {
                    text: responseText,
                    model_id: "eleven_multilingual_v2",
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75
                    }
                },
                {
                    headers: {
                        "xi-api-key": process.env.ELEVENLABS_API_KEY,
                        "Content-Type": "application/json"
                    },
                    responseType: "arraybuffer"
                }
            );

            const mp3Path = `tts_${Date.now()}.mp3`;
            const pcmPath = mp3Path.replace('.mp3', '.pcm');
            fs.writeFileSync(mp3Path, ttsRes.data);

            await new Promise((resolve, reject) => {
                const ffmpeg = spawn("ffmpeg", [
                    "-i", mp3Path,
                    "-f", "s16le",
                    "-ar", "8000",
                    "-ac", "1",
                    pcmPath
                ]);
                ffmpeg.on("exit", (code) => code === 0 ? resolve() : reject(new Error("FFmpeg failed")));
            });

            const rawPcm = fs.readFileSync(pcmPath);

            const chunkSize = 320;
            for (let i = 0; i < rawPcm.length; i += chunkSize) {
                const chunk = rawPcm.slice(i, i + chunkSize);
                const payload = chunk.toString("base64");

                ws.send(JSON.stringify({
                    event: "media",
                    stream_sid: streamSid,
                    media: {
                        chunk: ++chunkCounter,
                        timestamp: Date.now(),
                        payload
                    }
                }));

                await new Promise((res) => setTimeout(res, 20));
            }

            ws.send(JSON.stringify({
                event: "mark",
                stream_sid: streamSid,
                mark: { name: "end_of_tts" }
            }));

        } catch (err) {
            console.error("❌ TTS or stream error:", err.message);
        }
    });

    ws.on('close', () => {
        console.log('❎ WebSocket connection closed');
    });
});
