// components/RemoteMedia.tsx
import React, { useEffect, useRef } from "react";

type Props = {
    stream: MediaStream;
    kind: "audio" | "video";
};

const RemoteMedia: React.FC<Props> = ({ stream, kind }) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (kind === "audio" && audioRef.current) {
            audioRef.current.srcObject = stream;
        } else if (kind === "video" && videoRef.current) {
            videoRef.current.srcObject = stream;
        }
    }, [stream, kind]);

    return (
        <div className="media-wrapper">
            {kind === "video" && (
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    controls
                    style={{ width: "200px", height: "150px", objectFit: "cover" }}
                    className="remote-video"
                />
            )}
            <audio
                ref={audioRef}
                autoPlay
                playsInline
                style={{ display: "none" }}
                className="remote-audio"
            />
        </div>
    );
};

export default RemoteMedia;
