/*
 * 👋 Hello! This is an ml5.js example made and shared with ❤️.
 * Learn more about the ml5.js project: https://ml5js.org/
 * ml5.js license and Code of Conduct: https://github.com/ml5js/ml5-next-gen/blob/main/LICENSE.md
 *
 * This example demonstrates face tracking on live video through ml5.faceMesh.
 */

let faceMesh;
let video;
let faces = [];
let options = { maxFaces: 1, refineLandmarks: false, flipHorizontal: false };
let handpose;
let hands = [];
let colorHue = 0;  // For cycling colors
let trailCanvas;   // Second canvas for trails
let strobeTimer = 0;
let isStrobing = false;
let time = 0;
let faceTime = 0;  // Separate time for face warble
let delaunay;
let voronoiPoints = [];
let currentVoronoiPoints = [];
let targetVoronoiPoints = [];
const VORONOI_CONFIG = {
  LERP_SPEED: 0.7,
  RANDOM_POINTS: 15,
  FINGER_TIPS: [4, 8, 12, 16, 20],
  KNUCKLES: [2, 6, 10, 14, 18],
  FACE_POINT_SKIP: 3
};
let randomPoints = [];  // Store the random points
let currentRandomPoints = [];
let targetRandomPoints = [];

function preload() {
  // Load both models
  faceMesh = ml5.faceMesh(options);
  handpose = ml5.handPose();
}

function setup() {
  // Create video capture first with constraints for HD resolution
  video = createCapture({
    video: {
      width: { ideal: 1920 },    // Request HD resolution
      height: { ideal: 1080 }
    }
  });
  
  // Wait briefly for video to initialize
  video.size(windowWidth, windowHeight);  // Set video size to window size
  createCanvas(windowWidth, windowHeight);
  trailCanvas = createGraphics(windowWidth, windowHeight);
  trailCanvas.background(0);
  
  video.hide();
  
  // Start ML detection
  faceMesh.detectStart(video, gotFaces);
  handpose.detectStart(video, gotHands);
  
  colorMode(HSB);
}

function draw() {
  background(0);
  
  // Optimize time updates
  time += 0.02;
  colorHue = (colorHue + 2) % 360;
  let faceColor = color(colorHue, 100, 100);
  
  // More efficient trail fade
  trailCanvas.push();
  trailCanvas.fill(0, 25);
  trailCanvas.noStroke();
  trailCanvas.rect(0, 0, width, height);
  trailCanvas.pop();
  
  if (faces.length > 0) {
    let face = faces[0];  // Only process first face for performance
    updateVoronoiPoints(face, hands);
    
    delaunay = d3.Delaunay.from(currentVoronoiPoints);
    let voronoi = delaunay.voronoi([0, 0, width, height]);
    
    // Simplified drawing without bloom
    trailCanvas.stroke(faceColor);
    trailCanvas.strokeWeight(1);
    trailCanvas.noFill();
    
    for (let i = 0; i < currentVoronoiPoints.length; i++) {
      let cell = voronoi.cellPolygon(i);
      if (cell) {
        trailCanvas.beginShape();
        for (let point of cell) {
          trailCanvas.vertex(point[0], point[1]);
        }
        trailCanvas.endShape(CLOSE);
      }
    }
  } else {
    currentVoronoiPoints = [];
    targetVoronoiPoints = [];
    randomPoints = [];
  }
  
  image(trailCanvas, 0, 0);
}

// Callback function for when faceMesh outputs data
function gotFaces(results) {
  // Save the output to the faces variable
  faces = results;
}

// Callback function for handpose
function gotHands(results) {
  hands = results;
}

// Add windowResized function to handle window size changes
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  video.size(windowWidth, windowHeight);
  trailCanvas = createGraphics(windowWidth, windowHeight);
  trailCanvas.background(0);
}

function getFaceBoundingBox(face) {
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  
  for (let point of face.keypoints) {
    minX = min(minX, point.x);
    minY = min(minY, point.y);
    maxX = max(maxX, point.x);
    maxY = max(maxY, point.y);
  }
  
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

// Helper function to get points from a hand
function getHandPoints(hand) {
  let points = [];
  
  // Only use key points: fingertips and knuckles
  for (let i = 0; i < VORONOI_CONFIG.FINGER_TIPS.length; i++) {
    let tip = hand.keypoints[VORONOI_CONFIG.FINGER_TIPS[i]];
    let knuckle = hand.keypoints[VORONOI_CONFIG.KNUCKLES[i]];
    points.push([tip.x, tip.y]);
    points.push([knuckle.x, knuckle.y]);
  }
  
  // Add palm center
  let palm = hand.keypoints[0];
  points.push([palm.x, palm.y]);
  
  return points;
}

// Helper function to get face points
function getFacePoints(face) {
  let points = [];
  // Sample fewer face points
  for (let i = 0; i < face.keypoints.length; i += VORONOI_CONFIG.FACE_POINT_SKIP) {
    let keypoint = face.keypoints[i];
    points.push([keypoint.x, keypoint.y]);
  }
  return points;
}

// Helper function to draw a Voronoi cell
function drawVoronoiCell(cell, graphics, color) {
  if (!cell) return;
  
  // Draw multiple layers for glow effect
  for (let i = VORONOI_CONFIG.GLOW_LAYERS; i >= 0; i--) {
    graphics.push();
    graphics.strokeWeight(i * VORONOI_CONFIG.GLOW_SPREAD);
    let glowColor = color.levels;
    graphics.stroke(glowColor[0], glowColor[1], glowColor[2], 255 / (i + 1));
    
    graphics.beginShape();
    for (let point of cell) {
      graphics.vertex(point[0], point[1]);
    }
    graphics.endShape(CLOSE);
    graphics.pop();
  }
}

// Optimize point updates
function updateVoronoiPoints(face, hands) {
  targetVoronoiPoints = [];
  
  // Reduce allocations by pre-calculating array sizes
  let facePoints = getFacePoints(face);
  let handPoints = hands.flatMap(getHandPoints);
  
  targetVoronoiPoints.push(...facePoints);
  targetVoronoiPoints.push(...handPoints);
  targetVoronoiPoints.push(...currentRandomPoints);
  
  // Batch lerp updates
  if (currentVoronoiPoints.length !== targetVoronoiPoints.length) {
    currentVoronoiPoints = JSON.parse(JSON.stringify(targetVoronoiPoints));
  }
  
  for (let i = 0; i < currentVoronoiPoints.length; i++) {
    currentVoronoiPoints[i][0] = lerp(
      currentVoronoiPoints[i][0], 
      targetVoronoiPoints[i][0], 
      VORONOI_CONFIG.LERP_SPEED
    );
    currentVoronoiPoints[i][1] = lerp(
      currentVoronoiPoints[i][1], 
      targetVoronoiPoints[i][1], 
      VORONOI_CONFIG.LERP_SPEED
    );
  }
}
