import { Socket, Namespace } from "socket.io";
import { createWorker, mediaCodecs, createWebRtcTransport } from "./lib/utils";
import {
  Worker,
  Router,
  WebRtcTransport,
  Producer,
  Consumer,
} from "mediasoup/node/lib/types";

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

  const players: Record<string, Player> = {};
  let transports: TransportData[] = [];
  let producers: ProducerData[] = [];
  let consumers: ConsumerData[] = [];

  peers.on("connection", (socket: Socket) => {
    setInterval(() => {
      const allPlayerDetails = Object.values(players).map(
        (p) => p.playerDetails
      );
      peers.emit("players-update", allPlayerDetails);
    }, 30);

    const getTransport = (socketId: string) =>
      transports.find((t) => t.socketId === socketId && !t.consumer)?.transport;

    const getConsumerTransport = (socketId: string) =>
      transports.find((t) => t.socketId === socketId && t.consumer)?.transport;

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

    const getDistance = (p1: Player, p2: Player) =>
      Math.hypot(
        p1.playerDetails.coordinate.x - p2.playerDetails.coordinate.x,
        p1.playerDetails.coordinate.y - p2.playerDetails.coordinate.y
      );

    const checkAndUpdateProximity = async (socketId: string) => {
      const me = players[socketId];
      if (!me) return;

      for (const { socketId: otherId, producer } of producers) {
        if (otherId === socketId) continue;

        const other = players[otherId];
        if (!other) continue;

        const dist = getDistance(me, other);
        const consumerData = consumers.find(
          (c) =>
            c.socketId === socketId && c.consumer.producerId === producer.id
        );

        if (dist <= 100) {
          if (!consumerData) {
            let recvTransport = getConsumerTransport(socketId);
            if (!recvTransport) {
              recvTransport = await createWebRtcTransport(router);
              if (!recvTransport) return;

              addTransport(recvTransport, true);
              me.socket.emit("create-consumer-transport", {
                params: {
                  id: recvTransport.id,
                  iceParameters: recvTransport.iceParameters,
                  iceCandidates: recvTransport.iceCandidates,
                  dtlsParameters: recvTransport.dtlsParameters,
                },
              });
              return;
            }

            me.socket.emit("consume-producers", {
              producerIds: [producer.id],
            });
          } else if (consumerData.consumer.paused) {
            await consumerData.consumer.resume();
            me.socket.emit("consumer-resumed", {
              remoteProducerId: producer.id,
            });
          }
        } else {
          if (consumerData && !consumerData.consumer.closed) {
            // Close the consumer completely
            consumerData.consumer.close();

            // Remove from server-side list
            consumers = consumers.filter(
              (c) => c.consumer.id !== consumerData.consumer.id
            );

            // Let the client know to remove the media element
            me.socket.emit("producer-closed", {
              remoteProducerId: producer.id,
            });
          }
        }
      }
    };

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

      callback({
        rtpCapabilities: router.rtpCapabilities,
        playerDetails: players[socket.id].playerDetails,
      });
    });

    socket.on("update-position", async ({ newX, newY }) => {
      const p = players[socket.id];
      if (!p) return;

      p.playerDetails.coordinate = { x: newX, y: newY };
      await checkAndUpdateProximity(socket.id);

      for (const id in players) {
        if (id !== socket.id) await checkAndUpdateProximity(id);
      }
    });

    socket.on("createWebRtcTransport", async ({ consumer }, callback) => {
      const transport = await createWebRtcTransport(router);
      if (!transport) return;

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
      const transport = getTransport(socket.id);
      if (transport) transport.connect({ dtlsParameters });
    });

    socket.on(
      "transport-produce",
      async ({ kind, rtpParameters }, callback) => {
        const transport = getTransport(socket.id);
        if (!transport) return;

        const producer = await transport.produce({ kind, rtpParameters });
        addProducer(producer);

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
        const t = transports.find(
          (t) => t.consumer && t.transport.id === serverConsumerTransportId
        );
        await t?.transport.connect({ dtlsParameters });
      }
    );

    socket.on(
      "server-consume",
      async (
        { rtpCapabilities, remoteProducerId, serverConsumerTransportId },
        callback
      ) => {
        try {
          const transport = transports.find(
            (t) => t.consumer && t.transport.id === serverConsumerTransportId
          )?.transport;

          if (
            transport &&
            router.canConsume({ producerId: remoteProducerId, rtpCapabilities })
          ) {
            const consumer = await transport.consume({
              producerId: remoteProducerId,
              rtpCapabilities,
              paused: true,
            });

            consumer.on("producerclose", () => {
              socket.emit("producer-closed", { remoteProducerId });
              consumer.close();
              consumers = consumers.filter(
                (c) => c.consumer.id !== consumer.id
              );
            });

            addConsumer(consumer);

            callback({
              params: {
                id: consumer.id,
                producerId: remoteProducerId,
                kind: consumer.kind,
                rtpParameters: consumer.rtpParameters,
                serverConsumerId: consumer.id,
              },
            });
          }
        } catch (err: any) {
          console.error(err.message);
          callback({ params: { error: err.message } });
        }
      }
    );

    socket.on("consumer-resume", async ({ serverConsumerId }) => {
      const cdata = consumers.find((c) => c.consumer.id === serverConsumerId);
      await cdata?.consumer.resume();
    });

    socket.on("disconnect", () => {
      consumers = consumers.filter((c) => {
        if (c.socketId === socket.id) {
          c.consumer.close();
          return false;
        }
        return true;
      });

      producers = producers.filter((p) => {
        if (p.socketId === socket.id) {
          p.producer.close();
          return false;
        }
        return true;
      });

      transports = transports.filter((t) => {
        if (t.socketId === socket.id) {
          t.transport.close();
          return false;
        }
        return true;
      });

      delete players[socket.id];
    });
  });
};
