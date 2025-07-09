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

// Type for the peers object (you could refine this further)
type PeersMap = { [socketId: string]: Player };

// Individual player’s data
interface Player {
  socket: Socket;
  transports: string[];
  producers: string[];
  consumers: string[];
  peerDetails: {
    name: string;
  };
}

// Transport object structure
interface TransportData {
  socketId: string;
  transport: WebRtcTransport;
  consumer: boolean;
}

// Producer object structure
interface ProducerData {
  socketId: string;
  producer: Producer;
}

// Consumer object structure
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
    const getTransport = (socketId: string): WebRtcTransport | undefined => {
      const result = transports.find(
        (t) => t.socketId === socketId && !t.consumer
      );
      return result?.transport;
    };

    const informConsumers = (socketId: string, producerId: string) => {
      console.log(`Just joined, id ${producerId}, ${socketId}`);
      producers.forEach(({ socketId: id, producer }) => {
        if (id !== socketId) {
          const producerSocket = players[id]?.socket;
          producerSocket?.emit("new-producer", { producerId });
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

    console.log(`New client connected: ${socket.id}`);
    socket.emit("connection-success", { socketId: socket.id });

    socket.on(
      "join-game",
      async ({ userName }: { userName: string }, callback) => {
        players[socket.id] = {
          socket,
          transports: [],
          producers: [],
          consumers: [],
          peerDetails: { name: userName },
        };

        const rtpCapabilities = router.rtpCapabilities;
        callback({ rtpCapabilities });
      }
    );

    socket.on(
      "getRtpCapabilities",
      (callback: (data: { rtpCapabilities: RtpCapabilities }) => void) => {
        callback({ rtpCapabilities: router.rtpCapabilities });
      }
    );

    socket.on(
      "createWebRtcTransport",
      async (
        { consumer }: { consumer: boolean },
        callback: (data: any) => void
      ) => {
        const transport = await createWebRtcTransport(router);
        if (!transport) {
          console.error("Error creating transport");
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
      }
    );

    socket.on("getProducers", (callback: (producerList: string[]) => void) => {
      const producerList = producers
        .filter((p) => p.socketId !== socket.id)
        .map((p) => p.producer.id);

      callback(producerList);
    });

    socket.on(
      "transport-connect",
      ({ dtlsParameters }: { dtlsParameters: DtlsParameters }) => {
        console.log("DTLS PARAMS... ", dtlsParameters);
        getTransport(socket.id)?.connect({ dtlsParameters });
      }
    );

    socket.on(
      "transport-produce",
      async (
        {
          kind,
          rtpParameters,
        }: {
          kind: MediaKind;
          rtpParameters: RtpParameters;
          appData?: any;
        },
        callback: (data: { id: string; producersExist: boolean }) => void
      ) => {
        const producer = await getTransport(socket.id)?.produce({
          kind,
          rtpParameters,
        });

        if (!producer) return;

        addProducer(producer);
        informConsumers(socket.id, producer.id);

        producer.on("transportclose", () => {
          console.log("Producer transport closed");
          producer.close();
        });

        callback({
          id: producer.id,
          producersExist: producers.length > 1,
        });
      }
    );

    socket.on(
      "transport-recv-connect",
      async ({
        dtlsParameters,
        serverConsumerTransportId,
      }: {
        dtlsParameters: DtlsParameters;
        serverConsumerTransportId: string;
      }) => {
        const consumerTransport = transports.find(
          (t) => t.consumer && t.transport.id === serverConsumerTransportId
        )?.transport;

        await consumerTransport?.connect({ dtlsParameters });
      }
    );

    socket.on(
      "consume",
      async (
        {
          rtpCapabilities,
          remoteProducerId,
          serverConsumerTransportId,
        }: {
          rtpCapabilities: RtpCapabilities;
          remoteProducerId: string;
          serverConsumerTransportId: string;
        },
        callback: (data: { params?: any }) => void
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

            consumer.on("transportclose", () => {
              console.log("Consumer transport closed");
            });

            consumer.on("producerclose", () => {
              console.log("Producer of consumer closed");
              socket.emit("producer-closed", { remoteProducerId });

              consumerTransport.close();
              transports = transports.filter(
                (t) => t.transport.id !== consumerTransport.id
              );
              consumer.close();
              consumers = consumers.filter(
                (c) => c.consumer.id !== consumer.id
              );
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

    socket.on(
      "consumer-resume",
      async ({ serverConsumerId }: { serverConsumerId: string }) => {
        console.log("Consumer resume");
        const consumerData = consumers.find(
          (c) => c.consumer.id === serverConsumerId
        );
        await consumerData?.consumer.resume();
      }
    );

    socket.on("disconnect", () => {
      console.log("Player disconnected");
      consumers = removeItems(consumers, "consumer");
      producers = removeItems(producers, "producer");
      transports = removeItems(transports, "transport");
      delete players[socket.id];
    });
  });
};
