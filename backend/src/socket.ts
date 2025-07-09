import { Server, Socket } from "socket.io";
import { createWorker, mediaCodecs, createWebRtcTransport } from "./lib/utils";

export const initSocket = async (peers: any) => {
  const worker = await createWorker();
  const router = await worker.createRouter({ mediaCodecs });

  let producerTransport: any;
  let consumerTransport: any;
  let transport;
  let producer: any;
  let consumer: any;
  peers.on("connection", (socket: Socket) => {
    console.log(`New client connected: ${socket.id}`);
    socket.emit("connection-success", { socketId: socket.id });

    socket.on("getRtpCapabilities", (callback) => {
      callback({ rtpCapabilities: router.rtpCapabilities });
    });

    socket.on("createWebRtcTransport", async ({ sender }, callback) => {
      console.log(`Sender Request : ${sender}`);
      transport = await createWebRtcTransport(router, callback);
      if (sender) producerTransport = transport;
      else consumerTransport = transport;
      console.log(transport);
    });

    socket.on("transport-connect", async ({ dtlsParameters }) => {
      console.log("DTLS PARAMS... ", { dtlsParameters });
      await producerTransport.connect({ dtlsParameters });
    });

    socket.on(
      "transport-produce",
      async ({ kind, rtpParameters, appData }, callback) => {
        // call produce based on the prameters from the client
        producer = await producerTransport.produce({
          kind,
          rtpParameters,
        });

        console.log("Producer ID: ", producer.id, producer.kind);

        producer.on("transportclose", () => {
          console.log("transport for this producer closed ");
          producer.close();
        });

        // Send back to the client the Producer's id
        callback({
          id: producer.id,
        });
      }
    );

    // see client's socket.emit('transport-recv-connect', ...)
    socket.on("transport-recv-connect", async ({ dtlsParameters }) => {
      console.log(`DTLS PARAMS: ${dtlsParameters}`);
      await consumerTransport.connect({ dtlsParameters });
    });

    socket.on("consume", async ({ rtpCapabilities }, callback) => {
      try {
        // check if the router can consume the specified producer
        if (
          router.canConsume({
            producerId: producer.id,
            rtpCapabilities,
          })
        ) {
          // transport can now consume and return a consumer
          consumer = await consumerTransport.consume({
            producerId: producer.id,
            rtpCapabilities,
            paused: true,
          });

          consumer.on("transportclose", () => {
            console.log("transport close from consumer");
          });

          consumer.on("producerclose", () => {
            console.log("producer of consumer closed");
          });

          // from the consumer extract the following params
          // to send back to the Client
          const params = {
            id: consumer.id,
            producerId: producer.id,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          };

          // send the parameters to the client
          callback({ params });
        }
      } catch (error: any) {
        console.log(error.message);
        callback({
          params: {
            error: error,
          },
        });
      }
    });

    socket.on("consumer-resume", async () => {
      console.log("consumer resume");
      await consumer.resume();
    });

    socket.on("disconnect", () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });
};
