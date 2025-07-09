// (all import statements remain unchanged)
import { Socket, Namespace } from "socket.io";
import { createWorker, mediaCodecs, createWebRtcTransport } from "./lib/utils";
import {
  Worker,
  Router,
  RtpCapabilities,
  WebRtcTransport,
  Producer,
  Consumer,
  DtlsParameters,
  RtpParameters,
  MediaKind,
} from "mediasoup/node/lib/types";

// Types (unchanged)
type PeersMap = { [socketId: string]: Player };

interface Player {
  socket: Socket;
  transports: string[];
  producers: string[];
  consumers: string[];
  playerDetails: {
    socketId: string;
    name: string;
    coordinate: { x: number; y: number };
  };
}

interface TransportData {
  socketId: string;
  transport: WebRtcTransport;
  consumer: boolean;
}

interface ProducerData {
  socketId: string;
  producer: Producer;
}

interface ConsumerData {
  socketId: string;
  consumer: Consumer;
}

export const initSocket = async (peers: Namespace) => {
  const worker: Worker = await createWorker();
  const router: Router = await worker.createRouter({ mediaCodecs });

  let players: Record<string, Player> = {};
  let transports: TransportData[] = [];
  let producers: ProducerData[] = [];
  let consumers: ConsumerData[] = [];

  peers.on("connection", (socket: Socket) => {
    setInterval(() => {
      const allPlayerDetails = Object.values(players).map(
        (player) => player.playerDetails
      );
      peers.emit("players-update", allPlayerDetails);
    }, 30);

    const getTransport = (socketId: string): WebRtcTransport | undefined => {
      const result = transports.find(
        (t) => t.socketId === socketId && !t.consumer
      );
      return result?.transport;
    };

    const informConsumers = (socketId: string, producerId: string) => {
      producers.forEach(({ socketId: id }) => {
        if (id !== socketId) {
          const playerSocket = players[id]?.socket;
          if (playerSocket) {
            const distance = getDistance(players[socketId], players[id]);
            if (distance <= 10) {
              playerSocket.emit("consume-producers", {
                producerIds: [producerId],
              });
            }
          }
        }
      });
    };

    const removeItems = <T>(items: T[], type: keyof T): T[] => {
      items.forEach((item: any) => {
        if (item.socketId === socket.id) {
          item[type]?.close?.();
        }
      });
      return items.filter((item: any) => item.socketId !== socket.id);
    };

    const addTransport = (transport: WebRtcTransport, consumer: boolean) => {
      transports.push({ socketId: socket.id, transport, consumer });
      players[socket.id].transports.push(transport.id);
    };

    const addProducer = (producer: Producer) => {
      producers.push({ socketId: socket.id, producer });
      players[socket.id].producers.push(producer.id);
    };

    const addConsumer = (consumer: Consumer) => {
      consumers.push({ socketId: socket.id, consumer });
      players[socket.id].consumers.push(consumer.id);
    };

    const getDistance = (player1: Player, player2: Player): number => {
      const dx =
        player1.playerDetails.coordinate.x - player2.playerDetails.coordinate.x;
      const dy =
        player1.playerDetails.coordinate.y - player2.playerDetails.coordinate.y;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const checkAndUpdateProximity = (socketId: string) => {
      const myPlayer = players[socketId];
      if (!myPlayer) return;

      producers.forEach((p) => {
        if (p.socketId === socketId) return;

        const otherPlayer = players[p.socketId];
        if (!otherPlayer) return;

        const distance = getDistance(myPlayer, otherPlayer);

        const isAlreadyConsuming = consumers.some(
          (c) =>
            c.socketId === socketId && c.consumer.producerId === p.producer.id
        );

        if (distance <= 10 && !isAlreadyConsuming) {
          myPlayer.socket.emit("consume-producers", {
            producerIds: [p.producer.id],
          });
        } else if (distance > 10 && isAlreadyConsuming) {
          const consumerData = consumers.find(
            (c) =>
              c.socketId === socketId && c.consumer.producerId === p.producer.id
          );

          if (consumerData) {
            consumerData.consumer.close();
            consumers = consumers.filter(
              (c) => c.consumer.id !== consumerData.consumer.id
            );

            const t = transports.find(
              (t) => t.consumer && t.socketId === socketId
            );
            if (t) {
              t.transport.close();
              transports = transports.filter(
                (tr) => tr.transport.id !== t.transport.id
              );
            }

            myPlayer.socket.emit("producer-closed", {
              remoteProducerId: p.producer.id,
            });
          }
        }
      });
    };

    console.log("connection-success");

    socket.emit("connection-success", { socketId: socket.id });

    socket.on("join-game", async ({ userName }, callback) => {
      players[socket.id] = {
        socket,
        transports: [],
        producers: [],
        consumers: [],
        playerDetails: {
          socketId: socket.id,
          name: userName,
          coordinate: { x: 100, y: 100 },
        },
      };
      const rtpCapabilities = router.rtpCapabilities;
      let playerDetails = players[socket.id].playerDetails;
      socket.emit("join-sucess");
      callback({ rtpCapabilities, playerDetails });
    });

    socket.on("update-position", ({ newX, newY }) => {
      const player = players[socket.id];
      if (!player) {
        console.warn("Player not found for socket ID", socket.id);
        return;
      }

      player.playerDetails.coordinate = { x: newX, y: newY };
      // console.log(`[${player.playerDetails.name}] moved to (${newX}, ${newY})`);
      checkAndUpdateProximity(socket.id);
    });

    socket.on("getRtpCapabilities", (callback) => {
      callback({ rtpCapabilities: router.rtpCapabilities });
    });

    socket.on("createWebRtcTransport", async ({ consumer }, callback) => {
      const transport = await createWebRtcTransport(router);
      if (!transport) {
        console.error("Transport creation failed");
        return;
      }

      addTransport(transport, consumer);

      callback({
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        },
      });
    });

    socket.on("transport-connect", ({ dtlsParameters }) => {
      getTransport(socket.id)?.connect({ dtlsParameters });
    });

    socket.on(
      "transport-produce",
      async ({ kind, rtpParameters }, callback) => {
        const producer = await getTransport(socket.id)?.produce({
          kind,
          rtpParameters,
        });
        if (!producer) return;

        addProducer(producer);
        informConsumers(socket.id, producer.id);

        producer.on("transportclose", () => producer.close());

        callback({
          id: producer.id,
          producersExist: producers.length > 1,
        });
      }
    );

    socket.on(
      "transport-recv-connect",
      async ({ dtlsParameters, serverConsumerTransportId }) => {
        const consumerTransport = transports.find(
          (t) => t.consumer && t.transport.id === serverConsumerTransportId
        )?.transport;

        await consumerTransport?.connect({ dtlsParameters });
      }
    );

    socket.on(
      "server-consume",
      async (
        { rtpCapabilities, remoteProducerId, serverConsumerTransportId },
        callback
      ) => {
        try {
          const consumerTransport = transports.find(
            (t) => t.consumer && t.transport.id === serverConsumerTransportId
          )?.transport;

          if (
            router.canConsume({
              producerId: remoteProducerId,
              rtpCapabilities,
            }) &&
            consumerTransport
          ) {
            const consumer = await consumerTransport.consume({
              producerId: remoteProducerId,
              rtpCapabilities,
              paused: true,
            });

            consumer.on("transportclose", () => {});
            consumer.on("producerclose", () => {
              socket.emit("producer-closed", { remoteProducerId });

              consumer.close();
              consumers = consumers.filter(
                (c) => c.consumer.id !== consumer.id
              );

              transports = transports.filter(
                (t) => t.transport.id !== consumerTransport.id
              );
              consumerTransport.close();
            });

            addConsumer(consumer);

            const params = {
              id: consumer.id,
              producerId: remoteProducerId,
              kind: consumer.kind,
              rtpParameters: consumer.rtpParameters,
              serverConsumerId: consumer.id,
            };

            callback({ params });
          }
        } catch (err: any) {
          console.error(err.message);
          callback({ params: { error: err.message } });
        }
      }
    );

    socket.on("consumer-resume", async ({ serverConsumerId }) => {
      const consumerData = consumers.find(
        (c) => c.consumer.id === serverConsumerId
      );
      await consumerData?.consumer.resume();
    });

    socket.on("disconnect", () => {
      consumers = removeItems(consumers, "consumer");
      producers = removeItems(producers, "producer");
      transports = removeItems(transports, "transport");
      delete players[socket.id];
    });
  });
};
