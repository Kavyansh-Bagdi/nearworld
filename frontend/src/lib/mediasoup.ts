import { useEffect, useRef } from "react";
import { Device, types as mediasoupTypes } from "mediasoup-client";
import socket from "./socket";

export function useMediasoup(
  socketUrl: string,
  localAudioRef: React.RefObject<HTMLAudioElement>,
  localVideoRef: React.RefObject<HTMLVideoElement>,
  remoteContainerId: string
): { join: () => void } {
  const rtpCapabilitiesRef = useRef<mediasoupTypes.RtpCapabilities | null>(
    null
  );
  const deviceRef = useRef<Device | null>(null);
  const producerTransportRef = useRef<mediasoupTypes.Transport | null>(null);
  const consumerTransportRef = useRef<mediasoupTypes.Transport | null>(null);
  const producerRefs = useRef<mediasoupTypes.Producer[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteMediaElements = useRef<Map<string, HTMLMediaElement>>(new Map());
  const consumingProducers = useRef<Set<string>>(new Set());
  const consumeQueue = useRef<string[]>([]);
  const isConsumerReady = useRef(false);

  useEffect(() => {
    socket.connect();

    socket.on("producer-closed", ({ remoteProducerId }) => {
      removeRemoteMedia(remoteProducerId);
    });

    socket.on("consume-producers", async ({ producerIds }) => {
      for (const id of producerIds) {
        if (!isConsumerReady.current) {
          consumeQueue.current.push(id);
        } else {
          await consume(id);
        }
      }
    });

    socket.on("consumer-paused", ({ remoteProducerId }) => {
      removeRemoteMedia(remoteProducerId);
    });
    
    socket.on("consumer-resumed", async ({ remoteProducerId }) => {
      const el = remoteMediaElements.current.get(remoteProducerId);
      const existsInDOM = el && document.body.contains(el);

      if (!existsInDOM) {
        await consume(remoteProducerId);
      }
    });

    socket.on("create-consumer-transport", async ({ params }) => {
      const device = deviceRef.current!;
      const transport = device.createRecvTransport(params);

      transport.on("connect", ({ dtlsParameters }, callback, errback) => {
        try {
          socket.emit("transport-recv-connect", {
            dtlsParameters,
            serverConsumerTransportId: transport.id,
          });
          callback();
        } catch (err) {
          console.error("Consumer transport connect error:", err);
          errback(err);
        }
      });

      consumerTransportRef.current = transport;
      isConsumerReady.current = true;

      for (const id of consumeQueue.current) {
        await consume(id);
      }
      consumeQueue.current = [];
    });

    return () => {
      socket.disconnect();

      remoteMediaElements.current.forEach((el) => {
        el.pause();
        el.srcObject = null;
        el.remove();
      });
      remoteMediaElements.current.clear();

      localStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const join = () => {
    socket.emit(
      "join-game",
      { userName: "Kavyansh" },
      async ({
        rtpCapabilities,
        selfProducerIds,
      }: {
        rtpCapabilities: mediasoupTypes.RtpCapabilities;
        selfProducerIds?: string[];
      }) => {
        rtpCapabilitiesRef.current = rtpCapabilities;

        await startMedia();

        selfProducerIds?.forEach((id) => {
          remoteMediaElements.current.set(id, null as any);
        });

        isConsumerReady.current = true;
        for (const id of consumeQueue.current) {
          await consume(id);
        }
        consumeQueue.current = [];
      }
    );
  };

  const startMedia = async () => {
    await getLocalStream();
    await createDevice();
    await createSendTransport();
    await produceMedia();
    await createRecvTransport();
  };

  const getLocalStream = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    localStreamRef.current = stream;

    if (localAudioRef.current) localAudioRef.current.srcObject = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
  };

  const createDevice = async () => {
    const device = new Device();
    await device.load({ routerRtpCapabilities: rtpCapabilitiesRef.current! });
    deviceRef.current = device;
  };

  const createSendTransport = async () => {
    return new Promise<void>((resolve) => {
      socket.emit(
        "createWebRtcTransport",
        { consumer: false },
        async ({ params }) => {
          const device = deviceRef.current!;
          const transport = device.createSendTransport(params);
          producerTransportRef.current = transport;

          transport.on(
            "connect",
            async ({ dtlsParameters }, callback, errback) => {
              try {
                socket.emit("transport-connect", { dtlsParameters });
                callback();
              } catch (err) {
                console.error("Send transport connect error:", err);
                errback(err);
              }
            }
          );

          transport.on(
            "produce",
            async ({ kind, rtpParameters }, callback, errback) => {
              try {
                socket.emit(
                  "transport-produce",
                  { kind, rtpParameters },
                  ({ id }) => {
                    callback({ id });
                  }
                );
              } catch (err) {
                console.error("Produce error:", err);
                errback(err);
              }
            }
          );

          resolve();
        }
      );
    });
  };

  const produceMedia = async () => {
    const stream = localStreamRef.current!;
    const tracks = [...stream.getAudioTracks(), ...stream.getVideoTracks()];

    for (const track of tracks) {
      const producer = await producerTransportRef.current!.produce({ track });
      producerRefs.current.push(producer);
    }
  };

  const createRecvTransport = async () => {
    return new Promise<void>((resolve) => {
      socket.emit(
        "createWebRtcTransport",
        { consumer: true },
        async ({ params }) => {
          const device = deviceRef.current!;
          const transport = device.createRecvTransport(params);
          consumerTransportRef.current = transport;

          transport.on("connect", ({ dtlsParameters }, callback, errback) => {
            try {
              socket.emit("transport-recv-connect", {
                dtlsParameters,
                serverConsumerTransportId: transport.id,
              });
              callback();
            } catch (err) {
              console.error("Receive transport connect error:", err);
              errback(err);
            }
          });

          resolve();
        }
      );
    });
  };

  const consume = async (producerId: string) => {
    if (consumingProducers.current.has(producerId)) return;

    consumingProducers.current.add(producerId);

    if (!consumerTransportRef.current) {
      await createRecvTransport();
      isConsumerReady.current = true;
    }

    socket.emit(
      "server-consume",
      {
        rtpCapabilities: deviceRef.current!.rtpCapabilities,
        remoteProducerId: producerId,
        serverConsumerTransportId: consumerTransportRef.current!.id,
      },
      async ({ params }: { params: any }) => {
        if (params?.error) {
          console.error("Consume error:", params.error);
          consumingProducers.current.delete(producerId);
          return;
        }

        const consumer = await consumerTransportRef.current!.consume({
          id: params.id,
          producerId: params.producerId,
          kind: params.kind,
          rtpParameters: params.rtpParameters,
        });

        const stream = new MediaStream([consumer.track]);
        const el = document.createElement(
          params.kind === "audio" ? "audio" : "video"
        );

        if (params.kind === "video") {
          Object.assign(el.style, {
            width: "200px",
            height: "150px",
            objectFit: "cover",
          });

          el.muted = true; // Required for autoplay on mobile
        }

        el.srcObject = stream;
        el.autoplay = true;
        el.controls = true;
        el.playsInline = true;
        el.className = `media remote-${params.kind}`;

        const container = document.getElementById(remoteContainerId);
        if (container) {
          container.appendChild(el);
          remoteMediaElements.current.set(params.producerId, el);

          try {
            await el.play();
          } catch (e) {
            console.warn("Autoplay failed:", e);
          }

          socket.emit("consumer-resume", { serverConsumerId: consumer.id });
        } else {
          console.warn("Remote container not found. Element not added.");
        }

        consumingProducers.current.delete(producerId);
      }
    );
  };
  const removeRemoteMedia = (producerId: string) => {
    const el = remoteMediaElements.current.get(producerId);
    if (el) {
      el.pause();
      el.srcObject?.getTracks().forEach((track) => track.stop());
      el.srcObject = null;

      if (el.parentElement) {
        el.parentElement.removeChild(el); // safer than el.remove()
      }

      remoteMediaElements.current.delete(producerId);
    }

    consumingProducers.current.delete(producerId);
  };

  return { join };
}
