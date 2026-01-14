import os
import json
import subprocess
import re
import shutil
import sys
import argparse
from datetime import datetime

def report_progress(percent, message):
    """Output progress to stderr for parent process to read"""
    progress = {
        'progress': percent,
        'message': message,
        'timestamp': datetime.utcnow().isoformat()
    }
    print(f"PROGRESS:{json.dumps(progress)}", file=sys.stderr, flush=True)

def get_metadata(dcm_path):
    """Extract DICOM tags using ImageMagick identify."""
    cmd = ["magick", "identify", "-verbose", dcm_path]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        content = result.stdout
    except Exception as e:
        print(f"Error reading {dcm_path}: {e}")
        return {}

    tags = {
        "PatientName": r"dcm:Patient'sName: (.*)",
        "StudyDate": r"dcm:StudyDate: (.*)",
        "SeriesDescription": r"dcm:SeriesDescription: (.*)",
        "SeriesNumber": r"dcm:SeriesNumber: (.*)",
        "Modality": r"dcm:Modality: (.*)",
        "InstanceNumber": r"dcm:Instance.*Number: (.*)",
        "BodyPartExamined": r"dcm:BodyPartExamined: (.*)",
        "SliceLocation": r"dcm:SliceLocation: (.*)",
        "ProtocolName": r"dcm:ProtocolName: (.*)",
        "SliceThickness": r"dcm:SliceThickness: (.*)",
        "RepetitionTime": r"dcm:RepetitionTime: (.*)",
        "EchoTime": r"dcm:EchoTime: (.*)",
        "Orientation": r"dcm:ImageOrientation\(Patient\): (.*)",
        "WindowCenter": r"dcm:WindowCenter: (.*)",
        "WindowWidth": r"dcm:WindowWidth: (.*)",
        "InstitutionName": r"dcm:InstitutionName: (.*)",
        "StationName": r"dcm:StationName: (.*)",
        "Manufacturer": r"dcm:Manufacturer: (.*)",
        "ManufacturerModelName": r"dcm:ManufacturerModelName: (.*)"
    }
    
    data = {}
    for key, pattern in tags.items():
        match = re.search(pattern, content)
        if match:
            data[key] = match.group(1).strip()
    return data

def get_orientation_label(iop_str):
    if not iop_str: return ""
    try:
        nums = [abs(float(x.strip())) for x in iop_str.split('\\') if x.strip()]
        if len(nums) < 6: return ""
        if nums[0] > 0.7 and nums[4] > 0.7: return "Axial"
        if nums[0] > 0.7 and nums[5] > 0.7: return "Coronal"
        if nums[1] > 0.7 and nums[5] > 0.7: return "Sagittal"
    except: pass
    return ""

def convert_image(src, dst, wc=None, ww=None):
    """Convert DICOM to JPEG with Min-Max windowing using dcmj2pnm."""
    # User requested +Wm (Min-Max) windowing.
    # dcmj2pnm handles DICOM windowing much better than ImageMagick.
    # +Wm enables Min-Max windowing (Auto-windowing to min/max pixel values)
    # +oj enables JPEG output
    cmd = ["dcmj2pnm", "+Wm", "+oj", src, dst]
    
    subprocess.run(cmd, check=True)

def main():
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Process DICOM files to JPEG format')
    parser.add_argument('--input', required=False, help='Input DICOM directory',
                       default="viewer-mac.app/Contents/DICOM/DIR000")
    parser.add_argument('--output', required=False, help='Output directory for images',
                       default="output/img")
    parser.add_argument('--format', default='json', help='Output format (json or js)')
    args = parser.parse_args()

    INPUT_DIR = args.input
    OUTPUT_DIR = args.output
    DATA_FILE = os.path.join(OUTPUT_DIR, 'data.json')

    # Prepare environment
    if not os.path.exists(INPUT_DIR):
        print(f"Error: Input directory not found: {INPUT_DIR}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("Starting MRI Processing...")
    report_progress(0, "Initializing...")

    series_dirs = [d for d in os.listdir(INPUT_DIR) if os.path.isdir(os.path.join(INPUT_DIR, d))]
    series_list = []
    total_series = len(series_dirs)

    for idx, s_dir in enumerate(sorted(series_dirs)):
        full_s_path = os.path.join(INPUT_DIR, s_dir)

        # Find DICOM files - handle both flat and nested structures
        files = []
        for item in os.listdir(full_s_path):
            item_path = os.path.join(full_s_path, item)
            if item.upper().endswith(".DCM"):
                # Direct DICOM file in series folder
                files.append(item_path)
            elif os.path.isdir(item_path):
                # Check for DICOM files inside subdirectory (nested structure)
                for subitem in os.listdir(item_path):
                    if subitem.upper().endswith(".DCM"):
                        files.append(os.path.join(item_path, subitem))
                    elif not '.' in subitem:
                        # Files without extension - check if DICOM
                        subitem_path = os.path.join(item_path, subitem)
                        if os.path.isfile(subitem_path):
                            files.append(subitem_path)
            elif not '.' in item and os.path.isfile(item_path):
                # Files without extension in series folder
                files.append(item_path)

        if not files: continue

        progress = int((idx / total_series) * 100)
        report_progress(progress, f"Processing series {idx+1}/{total_series}: {s_dir}")
        print(f"Analyzing Series {s_dir} ({len(files)} slices)...")
        
        slices = []
        for f_path in files:
            meta = get_metadata(f_path)
            
            try: sloc = float(meta.get("SliceLocation") or 0)
            except: sloc = 0.0
            
            try: inum = int(meta.get("InstanceNumber") or 0)
            except: inum = 0
            
            slices.append({
                "path": f_path,
                "meta": meta,
                "sort_key": (sloc, inum, f_path)
            })
            
        # Perform stable sort
        slices.sort(key=lambda x: x["sort_key"])
        
        base = slices[0]["meta"]
        orientation = get_orientation_label(base.get("Orientation"))
        
        series_info = {
            "id": s_dir,
            "description": base.get("SeriesDescription") or base.get("ProtocolName") or "Series " + s_dir,
            "modality": base.get("Modality"),
            "patient": base.get("PatientName"),
            "date": base.get("StudyDate"),
            "body_part": (base.get("BodyPartExamined") or "Other").upper(),
            "protocol": base.get("ProtocolName"),
            "orientation": orientation,
            "slice_thickness": base.get("SliceThickness"),
            "tr": base.get("RepetitionTime"),
            "te": base.get("EchoTime"),
            "institution": base.get("InstitutionName"),
            "station": base.get("StationName"),
            "manufacturer": base.get("Manufacturer"),
            "model": base.get("ManufacturerModelName"),
            "images": []
        }
        
        series_out_dir = os.path.join(OUTPUT_DIR, s_dir)
        os.makedirs(series_out_dir, exist_ok=True)
        
        for i, slc in enumerate(slices):
            out_filename = f"{i:04d}.jpg"
            out_path = os.path.join(series_out_dir, out_filename)
            try:
                # Pass windowing params
                convert_image(slc["path"], out_path, 
                              wc=slices[0]["meta"].get("WindowCenter"), 
                              ww=slices[0]["meta"].get("WindowWidth"))
                series_info["images"].append(out_filename)
            except Exception as e:
                print(f"Error converting {slc['path']}: {e}")
            
        series_list.append(series_info)
        print(f"  -> Done. {len(series_info['images'])} images saved.")

    # Save to JSON
    report_progress(95, "Saving metadata...")
    with open(DATA_FILE, 'w') as f:
        json.dump({"series": series_list}, f, indent=2)

    report_progress(100, "Processing complete!")
    print("\nProcessing Complete!")
    print(f"Processed {len(series_list)} series")
    print(f"Output: {DATA_FILE}")

if __name__ == "__main__":
    main()
