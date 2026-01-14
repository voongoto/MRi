import os
import base64
import json
import requests
import math
import subprocess
from typing import List, Dict, Any
from PIL import Image, ImageDraw

LMSTUDIO_URL = "http://localhost:1234/v1/chat/completions"

def encode_pil_image(img: Image.Image) -> str:
    import io
    buffered = io.BytesIO()
    img.save(buffered, format="JPEG")
    return base64.b64encode(buffered.getvalue()).decode("utf-8")

def create_grid_image(image_paths: List[str], cols: int = 4) -> Image.Image:
    if not image_paths:
        return None
    
    images = []
    for p in image_paths:
        try:
            images.append(Image.open(p))
        except Exception as e:
            print(f"Error opening image {p}: {e}")
            
    if not images:
        return None
        
    w, h = images[0].size
    rows = math.ceil(len(images) / cols)
    grid_img = Image.new('RGB', (cols * w, rows * h), color=(0, 0, 0))
    
    for idx, img in enumerate(images):
        x = (idx % cols) * w
        y = (idx // cols) * h
        grid_img.paste(img, (x, y))
        
        draw = ImageDraw.Draw(grid_img)
        label = os.path.basename(image_paths[idx])
        draw.text((x + 5, y + 5), label, fill=(255, 255, 0))
        
    return grid_img

def launch_lmstudio():
    """Attempt to launch LM Studio and start the local server."""
    import time
    
    # First, check if server is already running
    try:
        test_response = requests.get("http://localhost:1234/v1/models", timeout=2)
        if test_response.status_code == 200:
            print("[AI] LM Studio server is already running.")
            return True
    except:
        pass  # Server not running, proceed to start it
    
    # Try to start the server using lms CLI
    try:
        print("[AI] Starting LM Studio server via CLI...")
        subprocess.run(["lms", "server", "start"], check=False, capture_output=True)
        
        # Wait for server to become available (up to 15 seconds)
        for i in range(15):
            try:
                test_response = requests.get("http://localhost:1234/v1/models", timeout=2)
                if test_response.status_code == 200:
                    print(f"[AI] Server started successfully after {i+1}s.")
                    return True
            except:
                pass
            time.sleep(1)
        
        print("[AI] Server did not start in time. Please start it manually in LM Studio.")
        return False
    except FileNotFoundError:
        # lms CLI not found, fall back to opening the app
        print("[AI] lms CLI not found, opening LM Studio app...")
        subprocess.run(["open", "-a", "LM Studio"], check=False)
        return False
    except Exception as e:
        print(f"[AI] Failed to start LM Studio server: {e}")
        return False

def analyze_series_ai(series_path: str, sample: int = 1, prompt: str = ""):
    """Analyze a series by individual slices for maximum quality."""
    # Launch LM Studio
    launch_lmstudio()
    
    # Get images
    all_images = sorted([f for f in os.listdir(series_path) if f.lower().endswith((".jpg", ".jpeg", ".png"))])
    images_to_process = all_images[::sample]
    
    if not images_to_process:
        return {"error": "No images found to process."}

    num_images = len(images_to_process)
    full_analysis = []
    
    print(f"Processing {num_images} images individually for maximum quality...")

    for idx, img_name in enumerate(images_to_process):
        img_path = os.path.join(series_path, img_name)
        
        try:
            with Image.open(img_path) as img:
                b64_data = encode_pil_image(img)
        except Exception as e:
            full_analysis.append(f"### Slice: {img_name}\nError loading image: {str(e)}")
            continue
            
        # Contextual prompt for individual slice
        slice_prompt = f"{prompt}\n\n(Study Context: Image {idx+1} of {num_images}, Filename: {img_name})"
        
        payload = {
            "model": "llava-1.6-mistral-7b",
            "messages": [
                {
                    "role": "system",
                    "content": "You are a detailed medical imaging analyst. Provide complete, thorough analysis for each anatomical structure. Never stop mid-sentence or leave assessments incomplete. Continue until you have fully analyzed all visible structures."
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": slice_prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{b64_data}"
                            }
                        }
                    ]
                }
            ],
            # Optimized for clinical accuracy
            "temperature": 0.1,
            "max_tokens": 8192,  # Explicit limit to avoid truncation (-1 may not work)
            "top_p": 0.95,
            "repeat_penalty": 1.1,
        }
        
        try:
            response = requests.post(LMSTUDIO_URL, json=payload, timeout=120)
            response.raise_for_status()
            result = response.json()
            analysis_text = result["choices"][0]["message"]["content"]
            full_analysis.append(f"### Slice: {img_name}\n{analysis_text}")
        except requests.exceptions.ConnectionError:
            return {"error": "LM Studio server not reached. Please ensure the local server is running on port 1234."}
        except Exception as e:
            full_analysis.append(f"### Slice: {img_name}\nError analyzing slice: {str(e)}")

    combined_report = "\n\n---\n\n".join(full_analysis)
    
    header = f"## High-Resolution Individual Slice Analysis ({num_images} slices)\n"
    header += "> [!NOTE]\n"
    header += "> This analysis was performed on individual slices to maintain full anatomical detail. Processing time is proportional to the number of slices.\n\n"
    
    return {
        "analysis": header + combined_report,
        "image_count": num_images
    }


def analyze_series_ai_streaming(series_path: str, sample: int = 1, prompt: str = "", mode: str = "series", slice_index: int = 0):
    """Generator that yields each slice analysis with thumbnail as they complete."""
    # Launch LM Studio
    launch_lmstudio()
    
    # Get images
    all_images = sorted([f for f in os.listdir(series_path) if f.lower().endswith((".jpg", ".jpeg", ".png"))])
    
    # Handle current slice mode vs full series
    if mode == "current" and 0 <= slice_index < len(all_images):
        images_to_process = [all_images[slice_index]]
    else:
        images_to_process = all_images[::sample]
    
    if not images_to_process:
        yield {"type": "error", "message": "No images found to process."}
        return

    num_images = len(images_to_process)
    
    # Send initial status
    yield {"type": "status", "message": f"Starting analysis of {num_images} slice(s)...", "total": num_images}

    for idx, img_name in enumerate(images_to_process):
        img_path = os.path.join(series_path, img_name)
        
        try:
            with Image.open(img_path) as img:
                # Create 128x128 thumbnail
                thumb = img.copy()
                thumb.thumbnail((128, 128), Image.Resampling.LANCZOS)
                thumb_b64 = encode_pil_image(thumb)
                
                # Full image for analysis
                b64_data = encode_pil_image(img)
        except Exception as e:
            yield {
                "type": "slice",
                "index": idx + 1,
                "total": num_images,
                "filename": img_name,
                "thumbnail": None,
                "analysis": f"Error loading image: {str(e)}"
            }
            continue
        
        # Send progress update
        yield {"type": "progress", "current": idx + 1, "total": num_images, "filename": img_name}
            
        # Contextual prompt for individual slice - emphasize fresh analysis
        slice_prompt = f"""{prompt}

CRITICAL: Analyze ONLY what you see in THIS specific image. Do not repeat observations from other images. Each slice is independent. Be specific to this exact slice.

(Image {idx+1} of {num_images}, Filename: {img_name})"""
        
        payload = {
            "model": "llava-1.6-mistral-7b",
            "messages": [
                {
                    "role": "system",
                    "content": "You are a detailed medical imaging analyst. Provide complete, thorough analysis for each anatomical structure. Never stop mid-sentence or leave assessments incomplete. Continue until you have fully analyzed all visible structures."
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": slice_prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{b64_data}"
                            }
                        }
                    ]
                }
            ],
            # Optimized for clinical accuracy with anti-repetition
            "temperature": 0.2,          # Slightly higher for variety
            "max_tokens": 8192,            # Explicit limit to avoid truncation
            "top_p": 0.9,                
            "repeat_penalty": 1.3,       # Stronger penalty for repetition
            "presence_penalty": 0.5,     # Discourage repeating tokens
            "frequency_penalty": 0.3,    # Reduce frequent phrases
        }
        
        try:
            response = requests.post(LMSTUDIO_URL, json=payload, timeout=180)
            response.raise_for_status()
            result = response.json()
            analysis_text = result["choices"][0]["message"]["content"]
            
            yield {
                "type": "slice",
                "index": idx + 1,
                "total": num_images,
                "filename": img_name,
                "thumbnail": thumb_b64,
                "analysis": analysis_text
            }
        except requests.exceptions.ConnectionError:
            yield {"type": "error", "message": "LM Studio server not reached. Please ensure the local server is running on port 1234."}
            return
        except Exception as e:
            yield {
                "type": "slice",
                "index": idx + 1,
                "total": num_images,
                "filename": img_name,
                "thumbnail": thumb_b64,
                "analysis": f"Error analyzing slice: {str(e)}"
            }

    # Send completion
    yield {"type": "complete", "total": num_images}
