import os
import uuid
from uuid import UUID
from io import BytesIO
import asyncio
from datetime import datetime

import httpx  # For async HTTP requests
import os
import random
import string
from fastapi import Depends, HTTPException, APIRouter
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from datetime import datetime, timedelta
from pymongo import MongoClient
from bson import ObjectId
from passlib.context import CryptContext
from requests.adapters import HTTPAdapter
import MT5Manager
from dotenv import load_dotenv
import MetaTrader5 as mt5
from apscheduler.schedulers.background import BackgroundScheduler
import logging
from typing import List, Optional
import pytz
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail
import ssl
import threading
from apscheduler.triggers.interval import IntervalTrigger
from pymongo import DESCENDING
from sendgrid.helpers.mail import Email
import sendgrid
from sendgrid.helpers.mail import Mail, Email, To, TemplateId
import httpx
from tradelocker_user import *
import time
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio
import concurrent.futures
from concurrent.futures import ThreadPoolExecutor
from aiofiles import open as aio_open
import aiohttp
# from trading_checks_v2 import *
from pymongo import UpdateOne
from collections import defaultdict
from fastapi import HTTPException
from pydantic import BaseModel
from PIL import Image
from io import BytesIO
import httpx
import asyncio

manager = None

# Set up logging
logging.basicConfig(level=logging.INFO)
# Suppress APScheduler executor logs
logging.getLogger("apscheduler.executors.default").setLevel(logging.WARNING)
MONGODB_URI='mongodb+srv://info:c1xw37IjbpqdbhbdsbdnsbdjF@cluster0.vpt3p9z.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0'
# Load environment variables
load_dotenv()

# MongoDB connection
MONGODB_URL = os.getenv("MONGODB_URI")
DB_NAME = os.getenv("DB_NAME")
GROUP_FOR_BREACHED_ACCOUNTS = os.getenv("GROUP_FOR_BREACHED_ACCOUNTS")
NODE_SERVER_URL = os.getenv("NGROK_URL")  # Set this in your .env
ASSIGN_CERTIFICATE_URL = f"{NODE_SERVER_URL}/certificate/assign"
# dev
# client = MongoClient(MONGODB_URL)
# prod (only for  server)
from fastapi import FastAPI, UploadFile, File, Form, Request, HTTPException, BackgroundTasks, Body
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel
from typing import Optional, List

import numpy as np
import json
import pickle
import logging

from keras.models import load_model
import nltk
from nltk.stem import WordNetLemmatizer




client = AsyncIOMotorClient(
    MONGODB_URL,
)
db = client[DB_NAME]
users_collection = db["Users"]
mt5_credentials_collection = db["virtualtryon"]  # Collection for MT5 credentials
payment_collection = db["Discountvirtualtryon"]
Categories_collection = db["Categories"]
Items_collection = db["Items"]
# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI()

# Load CNN model
lemmatizer = WordNetLemmatizer()
model = load_model('model.h5')
words = pickle.load(open('texts.pkl', 'rb'))
classes = pickle.load(open('labels.pkl', 'rb'))

@app.on_event("startup")
def startup_event():
    logger.info("🚀 FastAPI app started")
    logger.info("✅ CNN model loaded")
    logger.info("✅ Vocabulary and classes loaded")


# ---------- Models ----------

class ImageEditRequest(BaseModel):
    prompt: str
    negative_prompt: str
    init_image: str
    cloth_image: str
    cloth_type: str
    height: int
    width: int


# ---------- Utility functions ----------

def clean_up_sentence(sentence):
    sentence_words = nltk.word_tokenize(sentence)
    sentence_words = [lemmatizer.lemmatize(w.lower()) for w in sentence_words]
    return sentence_words

def bow(sentence, words):
    sentence_words = clean_up_sentence(sentence)
    bag = [0] * len(words)
    for s in sentence_words:
        for i, w in enumerate(words):
            if w == s:
                bag[i] = 1
    return np.array(bag)

def predict_class(sentence):
    bow_vec = bow(sentence, words)
    res = model.predict(np.array([bow_vec]))[0]
    ERROR_THRESHOLD = 0.25
    results = [[i, r] for i, r in enumerate(res) if r > ERROR_THRESHOLD]
    results.sort(key=lambda x: x[1], reverse=True)
    return classes[results[0][0]] if results else "unknown"


# ---------- Route: First Model (CNN) ----------

@app.post("/api/edit-image")
async def edit_image(data: ImageEditRequest):
    """
    Handles the initial processing of the virtual try-on pipeline.
    
    Steps:
    1. Validate and log input.
    2. Perform prompt classification using CNN.
    3. Prepare structured payload for second model.
    4. Forward request and await response from second model.
    5. Return structured final response.

    Args:
        data (ImageEditRequest): Contains prompt, image URLs, sizes, and type.
    
    Returns:
        dict: Classification label and final processed image response.
    """
    logger.info("📥 Received request for image edit via /api/edit-image")

    # ----- Step 1: Log raw request data -----
    logger.debug(f"Raw Prompt: {data.prompt}")
    logger.debug(f"Negative Prompt: {data.negative_prompt}")
    logger.debug(f"Image Size: {data.height}x{data.width}")
    logger.debug(f"Initial Image URL: {data.init_image}")
    logger.debug(f"Cloth Image URL: {data.cloth_image}")
    logger.debug(f"Clothing Type: {data.cloth_type}")

    # ----- Step 2: CNN Classification -----
    logger.info("🔍 Classifying input text using trained CNN model...")
    classification = predict_class(data.prompt)

    if classification == "unknown":
        logger.warning("⚠️ Prompt could not be confidently classified. Using fallback.")
        classification = "generic"

    logger.info(f"🤖 CNN Classification Result: {classification}")

    # ----- Step 3: Prepare input for second model -----
    second_model_input = {
        "label": classification,
        "image_url": data.init_image,
        "cloth_url": data.cloth_image,
        "type": data.cloth_type
    }

    logger.debug("🧠 Prepared second model input:")
    logger.debug(json.dumps(second_model_input, indent=2))

    # Optional: Validate image URL format (simulated)
    if not data.init_image.startswith("http") or not data.cloth_image.startswith("http"):
        logger.error("❌ Invalid image URLs provided. Aborting operation.")
        return {"error": "Invalid image URLs"}

    # ----- Step 4: Call second model internally -----
    logger.info("📡 Forwarding request to second model service for enhancement...")
    try:
        result = await second_model_inference(second_model_input)
        logger.info("✅ Successfully received response from second model.")
    except Exception as e:
        logger.error(f"🔥 Failed to process request via second model: {e}")
        return {"error": "Failed at second model inference."}

    # ----- Step 5: Return the structured result -----
    response_payload = {
        "classification": classification,
        "final_output": result,
        "status": "success",
        "message": "Image processed successfully and forwarded to try-on pipeline"
    }

    logger.info("📤 Responding to client with classification and result data")
    return response_payload





























# ---------- Route: Second Model Logic ----------



class SecondModelInput(BaseModel):
    label: str
    image_url: str
    cloth_url: str
    type: str

# Define image size categories
def categorize_image_size(width: int, height: int) -> str:
    if 400 <= width <= 600 and 400 <= height <= 600:
        return "small"
    elif 700 <= width <= 900 and 700 <= height <= 900:
        return "medium"
    elif 1200 <= width <= 1600 and 1200 <= height <= 1600:
        return "large"
    else:
        return "unknown"

@app.post("/api/second-model")
async def second_model_api(input: SecondModelInput):
# Step 1: Validate URLs
    if not input.image_url.startswith("http") or not input.cloth_url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid image or cloth URL")

    if input.type.lower() not in ["tshirt", "pant", "tops"]:
        input.type = "tshirt"

    # Step 2: Categorize image sizes
    try:
        cloth_size_type = await get_image_size_category(input.cloth_url, mode="cloth")
        user_size_type = cloth_size_type
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image size check failed: {e}")

    # Step 3: Download both images and create UploadFile-like objects
    async def download_as_uploadfile(url: str, filename: str) -> UploadFile:
        async with httpx.AsyncClient() as client:
            res = await client.get(url)
            res.raise_for_status()
            file = SpooledTemporaryFile()
            file.write(res.content)
            file.seek(0)
            return StarletteUploadFile(filename=filename, file=file, content_type="image/png")

    try:
        model_upload = await download_as_uploadfile(input.image_url, "model.png")
        cloth_upload = await download_as_uploadfile(input.cloth_url, "cloth.png")
    except Exception as e:
        logger.error(f"❌ Image download failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch images from URLs")

    # Step 4: Call the virtual_tryon() function directly
    response = await virtual_tryon(
        model_image=model_upload,
        cloth_image=cloth_upload,
        blend_type="overlay"
    )
    return response  # FileResponse returned directly

# ----- Image Categorization Logic -----
async def get_image_size_category(image_url: str, mode: str = "user") -> str:
    logger.info(f"📥 Checking {mode} image dimensions...")

    async with httpx.AsyncClient() as client:
        response = await client.get(image_url)
        response.raise_for_status()
        image = Image.open(BytesIO(response.content))
        width, height = image.size

        logger.info(f"📐 {mode.capitalize()} image size: {width}x{height}")

        size_type = categorize_image_size(width, height)
        if size_type == "unknown":
            logger.warning(f"⚠️ {mode.capitalize()} image does not fit known categories.")
        return size_type




# ---------- Call Second Model Internally ----------

async def second_model_inference(payload: dict):
    from httpx import AsyncClient
    async with AsyncClient() as client:
        response = await client.post("http://localhost:8000/api/second-model", json=payload)
        return response.json()

# ---------- Call Third Model Internally ----------

@app.post("/api/virtual-tryon")
async def virtual_tryon(
    model_image: UploadFile = File(...),
    cloth_image: UploadFile = File(...),
    blend_type: str = Form("overlay")
):
    """
    Main endpoint that simulates the virtual try-on logic.
    Accepts two images:
    - Model image (person's base image)
    - Clothing image (enhanced image)
    Returns:
    - Final composited image
    """

    logger.info("📩 Received try-on request")
    logger.info("👤 Model image: %s", model_image.filename)
    logger.info("👕 Cloth image: %s", cloth_image.filename)
    logger.info("🧪 Blend type selected: %s", blend_type)

    # Step 1: Load model image
    model_bytes = await model_image.read()
    model_img = Image.open(BytesIO(model_bytes)).convert("RGBA")
    logger.info("✅ Model image loaded with size: %s", model_img.size)

    # Step 2: Load cloth image
    cloth_bytes = await cloth_image.read()
    cloth_img = Image.open(BytesIO(cloth_bytes)).convert("RGBA")
    logger.info("✅ Cloth image loaded with size: %s", cloth_img.size)

    # Step 3: Resize clothing image to fit over model image
    target_width = model_img.size[0]
    new_height = int(cloth_img.size[1] * (target_width / cloth_img.size[0]))
    resized_cloth = cloth_img.resize((target_width, new_height))
    logger.info("📐 Cloth image resized to: %s", resized_cloth.size)

    # Step 4: Create transparent canvas and paste images
    canvas_height = model_img.size[1]
    canvas = Image.new("RGBA", (target_width, canvas_height), (255, 255, 255, 0))
    canvas.paste(model_img, (0, 0))
    cloth_y_offset = int(canvas_height * 0.35)  # Adjust vertical placement
    canvas.paste(resized_cloth, (0, cloth_y_offset), resized_cloth)
    logger.info("🎨 Images composited successfully on canvas")

    # Step 5: Save output
    file_id = uuid.uuid4().hex
    output_path = os.path.join(OUTPUT_DIR, f"{file_id}_tryon.png")
    canvas.save(output_path)
    logger.info("📸 Final try-on image saved to %s", output_path)

    # Step 6: Return the final image
    return FileResponse(output_path, media_type="image/png", filename="tryon_result.png")
# ---------- Run the Server ----------

