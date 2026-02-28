FROM python:3.12-slim

WORKDIR /app

# Install OR-Tools (only dependency)
RUN pip install --no-cache-dir ortools

COPY optimizer_server.py .

# Expose on all interfaces so nginx can reach it
EXPOSE 5748

CMD ["python", "-u", "optimizer_server.py"]
