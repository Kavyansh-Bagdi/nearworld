import { rejects } from "assert";
import * as mediasoup from "mediasoup";
import { types } from "mediasoup";
import { resolve } from "path";

// =====================
// Media Codecs
// =====================
export const mediaCodecs: types.RtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
];

const transportOptions: types.WebRtcTransportOptions = {
  listenIps: [
    {
      ip: "192.168.57.59",
      announcedIp: undefined,
    },
  ],
  enableUdp: true,
  enableTcp: true,
  preferUdp: true,
  enableSctp: true,
};

// =====================
// Create Worker
// =====================
export const createWorker = async () => {
  const worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });

  console.log(`✅ Mediasoup worker created. PID: ${worker.pid}`);

  worker.on("died", () => {
    console.error("❌ Mediasoup worker died.");
    setTimeout(() => process.exit(1), 2000);
  });

  return worker;
};

// =====================
// Create WebRTC Transport
// =====================
export const createWebRtcTransport = async (router: types.Router) => {
  try {
    const transport = await router.createWebRtcTransport(transportOptions);
    console.log("WebRTC transport created:", transport.id);

    transport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "closed") transport.close();
    });

    return transport;
  } catch (error: any) {
    console.error("❌ WebRTC Transport creation failed:", error);
    rejects(error);
  }
};
