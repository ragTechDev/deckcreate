# Multi-stage Dockerfile for DeckCreate
# Includes all prerequisites: Node.js, Python 3.12, ffmpeg, and dependencies

FROM python:3.12-slim-bookworm AS base

# Install Node.js 20.x
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    git \
    libasound2 \
    libatk-bridge2.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Skip browser downloads from postinstall scripts (puppeteer, playwright).
# Do NOT use --ignore-scripts — it breaks native binary setup for lightningcss
# and @tailwindcss/oxide, which need their postinstall to copy the ARM64 .node file.
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV CHROMIUM_FLAGS=""

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci

# Copy application code
COPY . .

# Install Python dependencies globally (not in venv to avoid volume mount conflicts)
RUN pip install --upgrade pip setuptools wheel && \
    pip install -r scripts/diarize/requirements.txt && \
    pip install whisperx faster-whisper && \
    pip install -r scripts/camera/requirements.txt && \
    pip install -r scripts/thumbnail/requirements.txt && \
    pip install "coverage>=7.0"

# Ensure directories exist
RUN mkdir -p input/video input/audio \
    public/sync/video public/sync/audio public/sync/output \
    public/transcribe/input public/transcribe/output/raw \
    public/edit public/camera public/thumbnail \
    public/renders public/output

# Set environment variables
ENV PYTHON_PATH="/usr/local/bin/python"

# Expose ports for Next.js dev server and other services
EXPOSE 3000 3001

# Default command
CMD ["npm", "run", "dev"]
