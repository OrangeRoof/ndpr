'use strict';

// warpAffine speedup: NEED TO USE LOCAL REGION OF ROTATION AFTER CIRCLE DETECTED
// copy local region into black mask afterwards for draw
// look into: mat.estimateRigidTransform

const changeInstruction = text => $( '#status' ).first().html(text)
const onOpenCvReady = () => changeInstruction('OpenCV.js is ready. Input RPM of rotating frame, then select movie:')
const sleep = m => new Promise(r => setTimeout(r, m))

var center = {x: 0, y: 0} // set to values during radius spec (radii = 0) and by circle detection
var mouse = {x: 0, y: 0} // mouse values during mousedown before mouseup
var radii = undefined // set to values by user input and after circle
var frame_begin = Date.now()
var mat = undefined
var mat_dup = undefined
var mat_tmp = undefined
var rotMats = []
var nth
var vid
var drawables
var framesPerRotation = 0

// Draw-centric functions
const pullFrame = () => {
	frame_begin = Date.now()
	nth = Math.round($('#videoIn')[0].currentTime * 30) % framesPerRotation
	vid.read(mat)
}

const drawRadiiVisual = () => {
	return new Promise(async r => {
		cv.line(mat, center, mouse, [255, 128, 0, 255], 1)
		cv.circle(mat, center, Math.sqrt(Math.pow(mouse.x - center.x, 2) + Math.pow(mouse.y - center.y, 2)), [255, 128, 0, 255], 1)
	})
}

const drawMaskedDerotate = () => {
	return new Promise(async r => {
		maskMat()
		warpMat()
	})
}

const callNextFrame = () => {
	return new Promise(async r => {
		await sleep(1000/30 - (Date.now() - frame_begin))
		cv.imshow('canvasOut', mat)
	})
}

const drawLoop = async () => {
	pullFrame()
	let x = await Promise.all(drawables.map(f => f.apply(null)))
	drawLoop()
}

// OpenCV-centric functions
const detectCircle = () => {
	$( '#videoIn' )[0].pause()
	changeInstruction("Analyzing...")
	let circle = new cv.Mat()
	mat_dup = cv.Mat.zeros(mat.cols, mat.rows, cv.CV_8U)
	cv.cvtColor(mat, mat_dup, cv.COLOR_RGBA2GRAY, 0)
	cv.medianBlur(mat_dup, mat_dup, 5)
	cv.HoughCircles(mat_dup, circle, cv.HOUGH_GRADIENT, 1, radii-50, 300, 100, radii-50, 0)
	center.x = circle.data32F[0]; center.y = circle.data32F[1]; radii = circle.data32F[2]
	mat_dup.delete(); circle.delete()

	if (isNaN(center.x + center.y + radii)) {
		center.x = 0; center.y = 0; radii = 0;
		drawables = [drawRadiiVisual, callNextFrame]
		changeInstruction("Could not detect circle. Try again: Click-drag from center of rotation frame to edge of rotation frame.")
	} else {
		$( '#videoIn' )[0].currentTime = 0
		nth = 0
		makeBitMask()
		buildRotMats()
		drawables = [drawMaskedDerotate, callNextFrame]
		changeInstruction("Showing live preview of derotated video. Click \"Save\" to save derotated video, or \"Browse\" to change videos / reload and try detection again.")
	}
	$( '#videoIn' )[0].play()
}

const makeBitMask = () => {
	if (mat_tmp != undefined) {
		mat_tmp.delete(); mat_tmp = undefined
	}
	mat_tmp = new cv.Mat(mat.cols, mat.rows, cv.CV_8UC4, [0, 0, 0, 255])

	mat_dup = cv.Mat.zeros(mat.cols, mat.rows, cv.CV_8U)
	cv.circle(mat_dup, center, radii + 5, [255, 255, 255, 255], -1)
}

const maskMat = () => {
	mat.copyTo(mat_tmp, mat_dup)
	// do copy from mat_tmp back to mat along with warpAffine
	// mat_tmp.copyTo(mat)
}

const warpMat = () => {
	// todo: explicitly cache dims (?)
	cv.warpAffine(mat_tmp, mat, rotMats[nth], {width: mat.rows, height: mat.cols}, cv.INTER_LINEAR, cv.BORDER_CONSTANT, [0, 0, 0, 255])
}

const buildRotMats = () => {
	// get frames per rot from 30 fps and x RPM
	framesPerRotation = Math.round(1800 / Number($( '#rpm' ).attr('value')))
	let dAngle = - 360.0/framesPerRotation
	for(let i = 0; i < framesPerRotation; i++) {
		rotMats.push(cv.getRotationMatrix2D(center, dAngle * i, 1.0))
	}
}

// Event Listeners
$(window).on('load', () => {
	$( '#fileInput' ).on('change', e => {
		changeInstruction('Click-drag from center of rotation frame to edge of rotation frame.')
		$( '#videoIn' ).attr('src', URL.createObjectURL(e.target.files[0]))
	})

	// TODO: undecodable videos
	$( '#videoIn' ).on('loadeddata', e => {
		if (mat != undefined) {
			mat.delete(); mat = undefined
		}
		const vidIn = $( '#videoIn' )[0]
		// auto-resize window s.t. height, width < 1000
		let og_h = vidIn.videoHeight, og_w = vidIn.videoWidth
		let scale_factor = Math.max(og_h, og_w) / Math.min(1000, window.screen.availHeight, window.screen.availWidth)
		if (scale_factor > 1) {
			vidIn.height = Math.round(og_h / scale_factor); vidIn.width = Math.round(og_w / scale_factor)
		} else {
			vidIn.height = og_h; vidIn.width = og_w
		}
		vid = new cv.VideoCapture(vidIn)
		mat = new cv.Mat(vidIn.height, vidIn.width, cv.CV_8UC4)
		drawables = [drawRadiiVisual, callNextFrame]
		// only call loop if first entry TODO: nicer once function
		if (radii == undefined) {
			drawLoop()
		}
		radii = 0; center.x = 0; center.y = 0; mouse.x = 0; mouse.y = 0;
	})

	$( '#canvasOut' ).on('mousedown', e => {
		if(!radii) {
			center.x = e.offsetX; center.y = e.offsetY; mouse.x = e.offsetX; mouse.y = e.offsetY
	}})

	$( '#canvasOut' ).on('mousemove', e => {
		if(!radii && center.x && center.y) {
			mouse.x = e.offsetX; mouse.y = e.offsetY
	}})

	$( '#canvasOut' ).on('mouseup', e => {
		if(!radii) {
			radii = Math.sqrt(Math.pow(e.offsetX - center.x, 2) + 
								Math.pow(e.offsetY - center.y, 2))
			center.x = 0; center.y = 0; mouse.x = 0; mouse.y = 0;
			drawables = []
			detectCircle()
	}})
})
