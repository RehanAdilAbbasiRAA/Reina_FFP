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
users_collection = db["users"]
mt5_credentials_collection = db["mt5_credentials"]  # Collection for MT5 credentials
balance_equity_collection = db["trading_graph"]
deals_collection = db["deal_history"]
payment_collection = db["payments"]
payment_plans_collection = db["paymentplans"]
payout_details_collection = db["payoutdetails"]
# Certificate ID to add for users who meet the profit threshold
certificate_id = ObjectId("684073d0a85779f3d0cd1b0d")

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI()

# Load ANN model
lemmatizer = WordNetLemmatizer()
model = load_model('model.h5')
words = pickle.load(open('texts.pkl', 'rb'))
classes = pickle.load(open('labels.pkl', 'rb'))

@app.on_event("startup")
def startup_event():
    logger.info("🚀 FastAPI app started")
    logger.info("✅ ANN model loaded")
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


# ---------- Route: First Model (ANN) ----------

@app.post("/api/edit-image")
async def edit_image(data: ImageEditRequest):
    """
    Handles the initial processing of the virtual try-on pipeline.
    
    Steps:
    1. Validate and log input.
    2. Perform prompt classification using ANN.
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

    # ----- Step 2: ANN Classification -----
    logger.info("🔍 Classifying input text using trained ANN model...")
    classification = predict_class(data.prompt)

    if classification == "unknown":
        logger.warning("⚠️ Prompt could not be confidently classified. Using fallback.")
        classification = "generic"

    logger.info(f"🤖 ANN Classification Result: {classification}")

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

from fastapi import HTTPException

class SecondModelInput(BaseModel):
    label: str
    image_url: str
    cloth_url: str
    type: str


@app.post("/api/second-model")
async def second_model_api(input: SecondModelInput):
    """
    This endpoint simulates the second model in the virtual try-on pipeline.
    It enhances the cloth and user-provided images and prepares them for the final try-on model.

    Steps:
    1. Validate input URLs and type.
    2. Simulate enhancement of image and cloth.
    3. Combine processed data and return enhanced assets.
    """
    logger.info("🧠 Starting second model processing...")
    logger.debug(f"📥 Received Label: {input.label}")
    logger.debug(f"👕 Cloth Type: {input.type}")
    logger.debug(f"🖼️ Image URL: {input.image_url}")
    logger.debug(f"🖼️ Cloth URL: {input.cloth_url}")

    # ----- Step 1: Validate inputs -----
    if not input.image_url.startswith("http") or not input.cloth_url.startswith("http"):
        logger.error("❌ Invalid image URL(s) provided.")
        raise HTTPException(status_code=400, detail="Invalid image or cloth URL")

    if input.type.lower() not in ["tshirt", "pant", "hoodie", "saree", "dress","Polo shirt","shorts","Dress Shirt"]:
        logger.warning("⚠️ Unrecognized cloth type. Defaulting to 'tshirt'")
        input.type = "tshirt"

    # ----- Step 2: Simulate enhancement pipeline -----
    logger.info("✨ Enhancing input images...")

    enhanced_user_image_url = await simulate_image_enhancement(input.image_url, mode="user")
    enhanced_cloth_image_url = await simulate_image_enhancement(input.cloth_url, mode="cloth")

    logger.info("🧬 Enhancement complete. Preparing final result.")

    # ----- Step 3: Simulate combination or preparation for final model -----
    final_image_url = f"https://your-server.com/output/{input.label}_{input.type}_final.jpg"

    logger.debug(f"✅ Enhanced User Image: {enhanced_user_image_url}")
    logger.debug(f"✅ Enhanced Cloth Image: {enhanced_cloth_image_url}")
    logger.debug(f"🎯 Final Composed Image: {final_image_url}")

    return {
        "status": "success",
        "message": "Images enhanced and prepared for try-on",
        "enhanced_user_image": enhanced_user_image_url,
        "enhanced_cloth_image": enhanced_cloth_image_url,
        "generated_image": final_image_url
    }


# ----- Helper: Simulated enhancement logic -----
async def simulate_image_enhancement(image_url: str, mode: str = "user") -> str:
    """
    Simulates an image enhancement operation.
    In a real-world scenario, this would involve passing the image to a ML model or API.

    Args:
        image_url (str): The URL of the image to be enhanced.
        mode (str): Either 'user' or 'cloth' for respective processing.

    Returns:
        str: A fake but structured enhanced image URL.
    """
    logger.info(f"🔧 Simulating enhancement for {mode} image...")

    # Simulated delay for realism (optional)
    import asyncio
    await asyncio.sleep(0.3)

    # Simulated transformation logic (in production this would be actual enhancement code)
    enhanced_url = image_url.replace("upload", f"enhanced/{mode}/v2")
    return enhanced_url


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







# ---------- Call Fourth Model Internally ----------

class SaveImageRequest(BaseModel):
    image_url: str
    label: str
    user_id: str
    timestamp: Optional[str] = None

@app.post("/api/save-image")
async def save_generated_image(data: SaveImageRequest):
    """
    Simulates saving a generated image and related metadata to the database or filesystem.
    """
    logger.info("💾 Saving generated image...")

    # Step 1: Validate image URL
    if not data.image_url.startswith("http"):
        logger.error("❌ Invalid image URL received.")
        raise HTTPException(status_code=400, detail="Invalid image URL")

    # Step 2: Simulate database entry or file write
    image_metadata = {
        "user_id": data.user_id,
        "label": data.label,
        "url": data.image_url,
        "saved_at": data.timestamp or datetime.utcnow().isoformat()
    }

    logger.debug(f"📋 Metadata saved: {image_metadata}")

    # Step 3: Simulate success
    return {
        "status": "success",
        "message": "Image saved successfully",
        "data": image_metadata
    }






# ---------- Call Fifth Model Internally ----------
@app.post("/api/retrain-model")
async def retrain_model(background_tasks: BackgroundTasks, training_data_path: str = Body(..., embed=True)):
    """
    Simulates retraining the ML model from updated dataset (async style).
    This can be ANN, KNN, or hybrid.
    """
    logger.info("🔄 Retraining model requested...")

    if not os.path.exists(training_data_path):
        logger.warning("🚫 Training data not found.")
        raise HTTPException(status_code=404, detail="Training dataset not found.")

    background_tasks.add_task(simulate_training_pipeline, training_data_path)

    return {
        "status": "initiated",
        "message": f"Model retraining started using dataset: {training_data_path}"
    }

async def simulate_training_pipeline(path: str):
    """
    Simulates time-consuming model training process.
    """
    logger.info(f"📚 Simulating training on data at: {path}")

    # Simulate dataset loading
    await asyncio.sleep(1)
    logger.debug("📁 Dataset loaded")

    # Simulate preprocessing
    await asyncio.sleep(1)
    logger.debug("🧹 Data cleaned and normalized")

    # Simulate training
    await asyncio.sleep(2)
    logger.info("🧠 Model retrained successfully on new data")

    # Simulate saving model
    await asyncio.sleep(1)
    logger.info("💾 New model saved as `model_retrained.h5`")




if __name__ == "__main__":
    logger.info("💡 Starting Uvicorn server...")
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
