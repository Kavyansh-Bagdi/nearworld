import * as mediasoup from "mediasoup";
import { types } from "mediasoup";

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
// Create WebRTC Transport (Local Only)
// =====================
export const createWebRtcTransport = async (
  router: types.Router,
  callback: any
) => {
  try {
    const transportOptions: types.WebRtcTransportOptions = {
      listenIps: [
        {
          ip: "127.0.0.1", // For localhost only
          announcedIp: undefined, // No need for public IP in local setup
        },
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    };

    const transport = await router.createWebRtcTransport(transportOptions);
    console.log("✅ WebRTC transport created:", transport.id);

    transport.on("dtlsstatechange", (dtlsState) => {
      if (dtlsState === "closed") transport.close();
    });

    callback({
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
        // No iceServers needed locally
      },
    });

    return transport;
  } catch (error: any) {
    console.error("❌ WebRTC Transport creation failed:", error);
    callback({ params: { error: error.message } });
  }
};
