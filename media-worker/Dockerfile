# akoro media-worker — ffmpeg + the job server, nothing else.
# The API never touches media again: this container downloads from R2
# (or reads HLS streams directly), runs ffmpeg, uploads back to R2.
# linux/amd64 is what Containers runs — pin it so an Apple-Silicon or ARM
# build machine doesn't produce an image the platform rejects.
FROM --platform=linux/amd64 node:22-bookworm-slim

# ffmpeg/ffprobe from Debian — the same binaries the Render worker used.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    TEMP_DIR=/tmp \
    FFMPEG_PATH=ffmpeg \
    FFPROBE_PATH=ffprobe \
    PORT=8080

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
