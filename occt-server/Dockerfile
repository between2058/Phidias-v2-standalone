FROM continuumio/miniconda3:latest

WORKDIR /app

# Install pythonocc-core via conda-forge (not pip-installable)
RUN conda install -y -c conda-forge pythonocc-core=7.8.1 && \
    conda clean -afy

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8200

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8200", "--workers", "2"]
