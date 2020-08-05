'use strict';

// look into: mat.estimateRigidTransform
// look into: webworkers

const changeInstruction = text => $( '#status' ).first().html(text)
const onOpenCvReady = () => changeInstruction('OpenCV.js is ready. Select movie:')
const sleep = m => new Promise(r => setTimeout(r, m))

var center = {x: 0, y: 0} // set to values during radius spec (radii = 0) and by circle detection
var mouse = {x: 0, y: 0} // mouse values during mousedown before mouseup
var radii = undefined // set to values by user input and after circle
var frame_time = Date.now()
var mat = undefined
var mat_dup = undefined
var mat_tmp = undefined
var mat_tmp_tmp = undefined
var rot_mat
var vid
var drawables
var dAngle
var roiRect = undefined

// Draw-centric functions
const pullFrame = () => {
	frame_time = Date.now()
	dAngle = - (($('#videoIn')[0].currentTime / (60 / Number($('#rpm')[0].value))) % 1) * 360.0
	vid.read(mat)
}

const drawRadiiVisual = () => {
	return new Promise(async r => {
		cv.line(mat, center, mouse, [255, 128, 0, 255], 1)
		cv.circle(mat, center, Math.sqrt(Math.pow(mouse.x - center.x, 2) + Math.pow(mouse.y - center.y, 2)), [255, 128, 0, 255], 1)
		r()
	})
}

const drawMaskedDerotate = () => {
	return new Promise(async r => {
		cutMat()
		warpMatTmp()
		r()
	})
}

const drawMat = async () => {
	return new Promise(async r => {
		if (mat_tmp_tmp != undefined) {
			cv.imshow('canvasOut', mat_tmp_tmp)
		} else {
			cv.imshow('canvasOut', mat)
		}
		frame_time = Date.now() - frame_time
		if (frame_time < 29){
			await sleep(1000/30 - frame_time)
		}
		r()
	})
}


const drawLoop = async () => {
	while(true) {
		pullFrame()
		await Promise.all(drawables.map(f => f.apply(null)))
		if (mat_tmp_tmp != undefined) {
			cv.imshow('canvasOut', mat_tmp_tmp)
		} else {
			cv.imshow('canvasOut', mat)
		}
		frame_time = Date.now() - frame_time
		await sleep(1000/30 - frame_time)
	}
}

// OpenCV-centric functions
const detectCircle = () => {
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
		drawables = [drawRadiiVisual]
		roiRect = undefined
		changeInstruction("Could not detect circle. Try again: Click-drag from center of rotation frame to edge of rotation frame.")
	} else {
		makeBitMask()
		drawables = [drawMaskedDerotate]
		roiRect = new cv.Rect(Math.round(center.x - radii), Math.round(center.y - radii), Math.round(radii * 2), Math.round(radii * 2))
		changeInstruction("Showing live preview of derotated video. You can change the derotation RPM using the text box.")
	}
}

const makeBitMask = () => {
	if (mat_tmp != undefined) {
		mat_tmp.delete(); mat_tmp = undefined
	}
	if (mat_tmp_tmp != undefined) {
		mat_tmp_tmp.delete(); mat_tmp_tmp = undefined
	}
	mat_tmp = new cv.Mat(2*radii, 2*radii, cv.CV_8UC4, [0, 0, 0, 255])
	mat_tmp_tmp = new cv.Mat(2*radii, 2*radii, cv.CV_8UC4, [0, 0, 0, 255])

	mat_dup = cv.Mat.zeros(2*radii, 2*radii, cv.CV_8U)
	cv.circle(mat_dup, {x: radii, y: radii}, radii, [255, 255, 255, 255], -1)
}

const cutMat = () => {
	mat_tmp = mat.roi(roiRect)
}

const warpMatTmp = () => {
	rot_mat = cv.getRotationMatrix2D({x: radii, y: radii}, dAngle, 1.0)
	cv.warpAffine(mat_tmp, mat_tmp, rot_mat, {width: 2*radii, height: 2*radii})
	mat_tmp.copyTo(mat_tmp_tmp, mat_dup)
}

const resizeMat = () => {
	cv.resize(mat_tmp_tmp, mat, {width: mat.cols, height: mat.rows})
}

// Event Listeners
$(window).on('load', () => {
	$( '#fileInput' ).on('change', e => {
		changeInstruction('Click-drag from center of rotation frame to edge of rotation frame.\n If nothing shows up, the video type is unsupported.')
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
		drawables = [drawRadiiVisual]
		// only call loop if first entry TODO: nicer once function
		if (radii == undefined) {
			drawLoop()
		}
		radii = 0; center.x = 0; center.y = 0; mouse.x = 0; mouse.y = 0;
	})

	$( '#canvasOut' ).on('mousedown', e => {
		if(radii == 0) {
			center.x = e.offsetX; center.y = e.offsetY; mouse.x = e.offsetX; mouse.y = e.offsetY
			radii = -1
	}})

	$( '#canvasOut' ).on('mousemove', e => {
		if(radii == -1 && center.x && center.y) {
			mouse.x = e.offsetX; mouse.y = e.offsetY
	}})

	$( '#canvasOut' ).on('mouseup', e => {
		if(radii == -1) {
			radii = Math.sqrt(Math.pow(e.offsetX - center.x, 2) + 
								Math.pow(e.offsetY - center.y, 2))
			center.x = 0; center.y = 0; mouse.x = 0; mouse.y = 0;
			drawables = []
			detectCircle()
	}})
})
