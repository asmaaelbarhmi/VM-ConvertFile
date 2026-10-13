# Service complet : API + interface + moteur Ink/Stitch (sans Inkscape ni écran)
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends git libcairo2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements-backend.txt engine/requirements-moteur.txt engine/installer_inkstitch.sh ./engine_tmp/
RUN pip install --no-cache-dir -r engine_tmp/requirements-backend.txt

COPY engine/ engine/
RUN engine/installer_inkstitch.sh python

COPY backend/ backend/
COPY src/ src/
COPY frontend/ frontend/

ENV DONNEES_DIR=/data
VOLUME ["/data"]
EXPOSE 8000
CMD ["uvicorn", "backend.api:app", "--host", "0.0.0.0", "--port", "8000"]
