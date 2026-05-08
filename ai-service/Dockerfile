FROM python:3.11.15-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir \
        torch==2.7.1 \
        torchvision==0.22.1 \
        torchaudio==2.7.1 \
        --extra-index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt

COPY . .

ENV EASYOCR_MODEL_DIR=/app/easyocr_models
ENV RESUME_OCR_MODEL_DOWNLOAD_ENABLED=false

RUN mkdir -p /app/easyocr_models

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
