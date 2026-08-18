# Component 3 Vision Integration

This document describes the integration of Component 3 (Computer Vision pipeline) into the FocusTrack unified data collection system.

## Overview

Component 3 has been successfully integrated into the Student_DataCollection_UI, enabling simultaneous collection of:
- **Visual data** (Component 3): Face detection, gaze tracking, head pose, phone detection
- **Behavioral data** (Component 1): Keyboard/mouse activity
- **Environmental data** (Component 2): ESP32 sensor readings

## Architecture

### Browser-Based CV Processing
- Uses MediaPipe Face Mesh for facial landmark detection
- TensorFlow.js COCO-SSD for phone detection
- Processes frames at 3 FPS
- Sends data to backend every 2 seconds (aligned with other components)

### Components Created

#### Vision Processing Modules (`frontend/lib/vision/`)
- `config.ts` - Configuration constants
- `face-detector.ts` - MediaPipe Face Mesh integration
- `gaze-tracker.ts` - Eye gaze estimation and classification
- `pose-estimator.ts` - Head pose calculation
- `phone-detector.ts` - TensorFlow.js-based phone detection
- `vision-processor.ts` - Main coordinator

#### React Integration
- `hooks/use-vision.tsx` - Context provider and hook for vision state
- `components/features/vision/gaze-calibration.tsx` - Calibration UI component
- Enhanced `components/features/webcam/webcam-preview.tsx` with CV overlays

## User Flow

### Starting a Session with Vision
1. User opens sessions page
2. Checks "Vision consent" checkbox
3. Shows webcam view
4. Clicks "Start Session"
5. **Calibration modal appears**
   - 9-point on-screen calibration
   - 4 off-screen prompts (left, right, up, down)
   - Takes ~60 seconds
6. Session starts with all 3 data streams active

### During Session
- Webcam shows real-time CV overlays:
  - Face detection badge
  - Gaze state (on-screen/off-screen)
  - Head direction
  - Phone detection alert
- Data indicators show all 3 streams as "ACTIVE"
- Vision data sent to `/api/vision` every 2 seconds

## Data Schema

### VisionLog (Database)
```typescript
{
  session_id: UUID
  face_detected: boolean
  eye_gaze: "on-screen" | "off-screen" | "invalid"
  head_direction: "center" | "left" | "right" | "up" | "down"
  phone_detected: boolean
  created_at: timestamp
}
```

## Dependencies Added

```json
{
  "@mediapipe/face_mesh": "^0.4.1633559619",
  "@tensorflow/tfjs": "^4.22.0",
  "@tensorflow-models/coco-ssd": "^2.2.3"
}
```

## Installation

```bash
cd Student_DataCollection_UI/frontend
npm install
```

## Performance

- **Target**: 3 FPS processing
- **Memory**: ~200-300MB for MediaPipe + TensorFlow.js models
- **Browser**: Chrome/Edge recommended (best MediaPipe support)
- **CPU**: Runs efficiently on modern laptops

## Privacy

- No video recording (frames processed in-stream)
- Calibration data stored in session state only
- Raw video never leaves the browser
- Only extracted features sent to backend

## Troubleshooting

### "Please show the webcam view before starting"
- Click "Show View" button on webcam preview before starting session

### Calibration fails
- Ensure webcam is working and face is clearly visible
- Keep head still during calibration
- Good lighting helps significantly

### Vision indicator stays "OFF"
- Check console for errors
- Verify webcam permissions granted
- Ensure MediaPipe models loaded (check Network tab)

## Future Enhancements

- [ ] Save calibration per student (reuse across sessions)
- [ ] Add expression detection (optional feature)
- [ ] Implement Web Workers for background processing
- [ ] Add confidence thresholds in UI
- [ ] Export windowed aggregations for offline analysis

## Technical Notes

### Differences from Standalone Component 3
- **No windowing**: Sends raw features every 2s (not 5s aggregates)
- **Simplified schema**: 4 fields vs 15+ in standalone
- **Browser-based**: MediaPipe/TF.js instead of Python OpenCV
- **No YOLOv8**: Uses TensorFlow.js COCO-SSD for phones
- **Integrated backend**: Uses existing Supabase/PostgreSQL

### Calibration Algorithm
- Collects 30 iris position samples per calibration point
- Uses nearest-neighbor classification for on/off-screen
- Samples at 100ms intervals during collection
- Requires completion of all 9 on-screen + 4 off-screen points

## Testing

### Manual Test Flow
1. Start frontend: `npm run dev`
2. Login as test student
3. Show webcam view
4. Check vision consent
5. Start session
6. Complete calibration (follow dots)
7. Verify:
   - Vision indicator shows "ACTIVE"
   - CV overlays appear on webcam
   - VisionLog records in database
   - `/api/status/:sessionId` shows vision count

## Support

For issues or questions about the vision integration, check:
- Browser console for errors
- Network tab for failed API calls
- Database for VisionLog records
- Backend logs for vision API errors
