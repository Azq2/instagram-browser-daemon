async function mouseMoveAndClick(page, el) {
	await mouseMove(page, el);
	await el.click({delay: rand(10, 50)});
}

async function mouseMove(page, el) {
	let bound = await el.boundingBox();
	let metrics = await pageMetrics(page);
	
	if (bound.y < 0) {
		await mouseWheel(page, bound.y);
	} else if ((bound.y + bound.height) > metrics.innerHeight) {
		await mouseWheel(page, (bound.y + bound.height) - metrics.innerHeight);
	}
	
	metrics = await pageMetrics(page);
	bound = await el.boundingBox();
	
	let mouse_x = bound.x + rand(bound.width / 3, bound.width / 2);
	let mouse_y = bound.y + rand(bound.height / 3, bound.height / 2);
	
	if (mouse_x < 0 || mouse_x > metrics.innerWidth)
		throw new Error(`Position mismatch! mouse_x=${mouse_x}, window.innerWidth=${metrics.innerWidth}`);
	
	if (mouse_y < 0 || mouse_y > metrics.innerHeight)
		throw new Error(`Position mismatch! mouse_y=${mouse_y}, window.innerHeight=${metrics.innerHeight}`);
	
	await page.mouse.move(mouse_x, mouse_y, {
		steps:	rand(50, 100)
	});
}

async function mouseWheel(page, delta) {
	let dir = delta < 0 ? -1 : 1;
	delta = Math.abs(dir < 0 ? Math.floor(delta) : Math.ceil(delta));
	
	while (delta) {
		let step = Math.round(rand(30, 50));
		
		if (delta < step)
			step = delta;
		
		delta -= step;
		
		await page.mouse.wheel({deltaY: step * dir});
		await delay(rand(5, 10));
	}
	
	await delay(rand(200, 300));
}

async function pageMetrics(page) {
	return await page.evaluate(() => {
		return {
			scrollTop:		window.scrollY,
			scrollLeft:		window.scrollX,
			innerHeight:	window.innerHeight,
			innerWidth:		window.innerWidth
		};
	});
}

async function delay(timeout) {
	return await new Promise((resolve, reject) => {
		setTimeout(resolve, timeout);
	});
}

function rand(min, max) {
	return Math.random() * (max - min) + min;
}

export {mouseMoveAndClick, mouseMove, mouseWheel, pageMetrics, delay, rand};
