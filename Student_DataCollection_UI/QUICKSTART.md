# Quick Start Guide - Component 3 Vision Integration

## Prerequisites

- Node.js 18+ installed
- Chrome or Edge browser (recommended for MediaPipe)
- Webcam connected and working
- Supabase database configured

## Installation

```bash
cd Student_DataCollection_UI/frontend
npm install
```

This will install the new dependencies:
- @mediapipe/face_mesh
- @tensorflow/tfjs
- @tensorflow-models/coco-ssd

## Running the Application

### Start Frontend
```bash
cd Student_DataCollection_UI/frontend
npm run dev
```

### Start Backend (separate terminal)
```bash
cd Student_DataCollection_UI/backend
# Activate virtual environment
source venv/bin/activate  # or venv\Scripts\activate on Windows
# Start FastAPI
uvicorn app.main:app --reload
```

## Testing Vision Integration

### Step 1: Login
1. Navigate to `http://localhost:3000`
2. Login with test credentials

### Step 2: Prepare Session
1. Go to "Sessions" page
2. Fill in session details:
   - Task type (e.g., "coding")
   - Location (e.g., "home")
   - Expected duration (e.g., 30 minutes)

### Step 3: Connect Data Sources
1. **ESP32 (Component 2)**: Click "Connect ESP32" button
2. **Behavior (Component 1)**: Check "Behavior Logger" checkbox
3. **Vision (Component 3)**: Check "Vision consent" checkbox

### Step 4: Show Webcam
- Click "Show View" button on webcam preview
- Grant camera permissions if prompted
- Verify your face is visible in the preview

### Step 5: Start Session
1. Click "Start Session" button
2. **Calibration modal will appear**

### Step 6: Complete Calibration
**On-Screen Phase (9 points):**
- Green dot will appear in 9 positions
- Follow each dot with your eyes only
- Keep your head still
- Each point takes ~3 seconds

**Off-Screen Phase (4 prompts):**
- "Look LEFT" - Turn eyes to the left of screen
- "Look RIGHT" - Turn eyes to the right of screen  
- "Look UP" - Look at ceiling
- "Look DOWN" - Look at keyboard/desk
- Click "Next" after each prompt

**Total time: ~60 seconds**

### Step 7: Verify Active Session
After calibration completes:
- All 3 indicators should show "ACTIVE"
  - ESP32 (orange)
  - Behavior (purple)
  - Vision (purple)
- Webcam preview shows CV overlays:
  - "FACE" badge when face detected
  - "GAZE ON" / "GAZE OFF" for gaze state
  - "PHONE" alert if phone detected
  - Head direction (CENTER/LEFT/RIGHT/UP/DOWN)

## Troubleshooting

### "Please show the webcam view before starting"
**Solution**: Click "Show View" on webcam preview before starting session

### Calibration dots not appearing
**Problem**: Calibration modal not in fullscreen
**Solution**: Click "Start Calibration" button and allow fullscreen

### Vision indicator stays "OFF"
**Check**:
1. Open browser console (F12) for errors
2. Verify webcam permissions granted
3. Check Network tab - MediaPipe models should load
4. Ensure face is visible in webcam preview

### Poor gaze accuracy
**Causes**:
- Bad lighting
- Face not centered
- Glasses reflections
- Moving during calibration

**Solution**: Recalibrate with better conditions

### Phone detection not working
**Note**: COCO-SSD has moderate accuracy
**Tips**:
- Hold phone clearly in view
- Ensure good lighting
- Phone should be in frame for 2+ seconds

## Data Verification

### Check Database
```sql
-- Verify vision logs are being created
SELECT 
  session_id,
  face_detected,
  eye_gaze,
  head_direction,
  phone_detected,
  created_at
FROM vision_logs
WHERE session_id = '<your-session-id>'
ORDER BY created_at DESC
LIMIT 10;
```

### Check API Status
```bash
# Replace <session-id> with your actual session ID
curl http://localhost:8000/api/status/<session-id>
```

Expected response:
```json
{
  "environment": { "active": true, "lastSeen": "...", "count": 50 },
  "behavior": { "active": true, "lastSeen": "...", "count": 45 },
  "vision": { "active": true, "lastSeen": "...", "count": 42 }
}
```

## Performance Tips

### Optimize CV Processing
- Close other tabs to free up CPU
- Ensure good lighting for better face detection
- Keep face centered in frame
- Avoid moving head too much

### Browser Compatibility
- **Best**: Chrome, Edge (Chromium)
- **Works**: Firefox (slightly slower MediaPipe)
- **Avoid**: Safari (limited MediaPipe support)

### Session Duration
- Tested up to 30-minute sessions
- Memory stable with no leaks
- Can pause/resume without issues

## Common Workflows

### Standard Data Collection Session
1. Login
2. Setup session details
3. Connect ESP32
4. Enable behavior + vision
5. Show webcam
6. Start & calibrate
7. Collect data for X minutes
8. Submit concentration reports every 15 min
9. Stop session

### Recalibrating Mid-Session
**Currently**: Must stop and restart session
**Future**: Can add recalibration button

### Behavior-Only Session (No Vision)
- Don't check "Vision consent"
- Session starts immediately (no calibration)
- Vision indicator shows "NO CONSENT"

## Next Steps

1. **Test with real participants**
2. **Collect initial dataset**
3. **Verify data quality in database**
4. **Export for ML training**
5. **Iterate on CV algorithms if needed**

## Support

For issues:
1. Check browser console
2. Verify all 3 data sources configured
3. Review `VISION_INTEGRATION.md` for technical details
4. Check backend logs for API errors

## Success Indicators

✓ All 3 indicators show "ACTIVE"  
✓ Webcam shows CV overlays  
✓ Database has vision_logs records  
✓ Status API returns vision data  
✓ No console errors  
✓ Session runs for full duration  

**You're all set! Start collecting multimodal engagement data! 🚀**
