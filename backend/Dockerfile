# 1. Imagen base oficial de Python optimizada y ligera
FROM python:3.11-slim

# 2. Configurar variables de entorno esenciales para Python en contenedores
# PREVENT_BYTECODE: Evita que Python escriba archivos .pyc en el disco
# BUFFERED: Fuerza a que los logs se muestren en tiempo real en la consola de Render
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# 3. Establecer el directorio de trabajo dentro del contenedor
WORKDIR /app

# 4. Copiar primero solo el archivo de requerimientos
# Esto aprovecha la caché de Docker: si no cambias las librerías, no reinstala todo desde cero
COPY requirements.txt /app/

# 5. Instalar dependencias del sistema mínimas si fueran necesarias y las de Python
# --no-cache-dir reduce drásticamente el tamaño de la imagen final
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# 6. Copiar el resto del código fuente del backend al contenedor
COPY . /app/

# 7. Exponer el puerto que usará nuestra aplicación (Render asigna uno dinámico, pero internamente usamos el 8000)
EXPOSE 8000

# 8. Comando para arrancar la aplicación usando Uvicorn (servidor ASGI de alto rendimiento)
# Usamos el string 'app.main:app' asumiendo que tu archivo principal es main.py dentro de app/
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
