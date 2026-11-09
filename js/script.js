(() => {
// Find our date picker inputs on the page
const startInput = document.getElementById('startDate');
const endInput = document.getElementById('endDate');

// Call the setupDateInputs function from dateRange.js
// This sets up the date pickers to:
// - Default to a range of 9 days (from 9 days ago to today)
// - Restrict dates to NASA's image archive (starting from 1995)
setupDateInputs(startInput, endInput);

const dateForm = document.getElementById('dateForm');
const submitButton = dateForm.querySelector('button[type="submit"]');
const gallery = document.getElementById('gallery');
const statusMessage = document.getElementById('statusMessage');
const spaceFact = document.getElementById('spaceFact');
const modal = document.getElementById('apodModal');
const modalContent = modal.querySelector('.modal-content');
const modalMedia = document.getElementById('modalMedia');
const modalDate = document.getElementById('modalDate');
const modalTitle = document.getElementById('modalTitle');
const modalExplanation = document.getElementById('modalExplanation');
const closeModalButton = document.getElementById('closeModal');
const apodEarliestDate = '1995-06-16';
const apodApiKey = '';

const spaceFacts = [
	'Sunlight takes about 8 minutes and 20 seconds to reach Earth.',
	'A day on Venus is longer than its year: Venus rotates once in about 243 Earth days and orbits the Sun in about 225.',
	'Saturn is less dense than water on average, though there is no ocean large enough to hold it.',
	'The Moon is moving away from Earth by about 3.8 centimeters each year.',
	'Jupiter’s Great Red Spot is a giant storm that has been observed for centuries.',
	'The Milky Way contains hundreds of billions of stars.',
	'Mars has two small moons, Phobos and Deimos.'
];

spaceFact.textContent = spaceFacts[Math.floor(Math.random() * spaceFacts.length)];

dateForm.addEventListener('submit', async (event) => {
	event.preventDefault();

	const startDate = startInput.value;
	const endDate = endInput.value;
	const today = new Date().toISOString().split('T')[0];

	if (!startDate || !endDate) {
		showStatus('Choose both a start date and an end date.', 'error');
		return;
	}

	if (startDate < apodEarliestDate || endDate < apodEarliestDate || startDate > today || endDate > today || startDate > endDate) {
		showStatus('Choose a valid date range from June 16, 1995 through today.', 'error');
		return;
	}

	gallery.replaceChildren();
	showStatus('Loading space photos...');
	submitButton.disabled = true;

	try {
		let entries = [];
		try {
			const query = new URLSearchParams({
				api_key: apodApiKey,
				start_date: startDate,
				end_date: endDate
			});
			const response = await fetch(`https://api.nasa.gov/planetary/apod?${query}`);

			if (!response.ok) {
				const errorResponse = await response.json().catch(() => null);
				const apiMessage = errorResponse?.msg || errorResponse?.error?.message;
				throw new Error(apiMessage || 'NASA’s APOD API is unavailable.');
			}

			const result = await response.json();
			if (result && !Array.isArray(result) && result.msg) {
				throw new Error(result.msg);
			}

			entries = Array.isArray(result) ? result : result && result.date ? [result] : [];
		} catch (error) {
			console.warn('The legacy APOD API did not return usable data; trying NASA’s current APOD archive.', error);
		}

		if (entries.length === 0 || entries.some(isApodPlaceholder)) {
			entries = await fetchMigratedApodEntries(startDate, endDate);
		}

		if (entries.length === 0) {
			showStatus('No astronomy pictures were found for that date range.', 'error');
			return;
		}

		let renderedCount = 0;
		entries.forEach((entry) => {
			if (!entry || typeof entry !== 'object') {
				return;
			}
			if (isApodPlaceholder(entry)) {
				return;
			}
			try {
				gallery.append(createGalleryItem(entry));
				renderedCount += 1;
			} catch (error) {
				console.error('Skipping an APOD entry that could not be displayed.', error);
			}
		});

		if (renderedCount === 0) {
			showStatus('NASA returned no usable entries for that date range.', 'error');
			return;
		}

		showStatus(`${renderedCount} space photo${renderedCount === 1 ? '' : 's'} loaded.`);
	} catch (error) {
		showStatus(error.message || 'Unable to load space photos. Check your connection and try again.', 'error');
	} finally {
		submitButton.disabled = false;
	}
});

function showStatus(message, type = '') {
	statusMessage.textContent = message;
	statusMessage.className = `status-message${type ? ` ${type}` : ''}`;
}

function isApodPlaceholder(entry) {
	return entry.title === 'NASA Science'
		&& entry.url?.includes('/nasa-logo@2x.png');
}

async function fetchMigratedApodEntries(startDate, endDate) {
	const params = new URLSearchParams({
		after: `${shiftApodDate(startDate, -1)}T23:59:59`,
		before: `${shiftApodDate(endDate, 1)}T00:00:00`,
		per_page: '100',
		categories: '22766',
		_fields: 'date,title,content,link'
	});
	const posts = [];
	let totalPages = 1;

	for (let page = 1; page <= totalPages; page += 1) {
		params.set('page', String(page));
		const response = await fetch(`https://science.nasa.gov/wp-json/wp/v2/image-article?${params}`);
		if (!response.ok) {
			throw new Error('NASA’s APOD archive could not be reached. Please try again later.');
		}

		const pagePosts = await response.json();
		if (!Array.isArray(pagePosts)) {
			throw new Error('NASA’s APOD archive returned an unexpected response.');
		}
		posts.push(...pagePosts);

		if (page === 1) {
			totalPages = Number(response.headers.get('X-WP-TotalPages')) || 1;
			if (totalPages > 10) {
				throw new Error('Please choose a date range with no more than 1,000 APOD entries.');
			}
		}
	}

	return posts
		.map(createMigratedApodEntry)
		.filter(Boolean)
		.sort((firstEntry, secondEntry) => firstEntry.date.localeCompare(secondEntry.date));
}

function shiftApodDate(dateValue, dayOffset) {
	const date = new Date(`${dateValue}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + dayOffset);
	return date.toISOString().slice(0, 10);
}

function createMigratedApodEntry(post) {
	const content = new DOMParser().parseFromString(post.content?.rendered || '', 'text/html');
	const renderedTitle = new DOMParser().parseFromString(post.title?.rendered || '', 'text/html').body.textContent.trim();
	const title = renderedTitle
		.replace(/^APOD:\s*/i, '')
		.replace(/^(?:\d{4}\s+[A-Za-z]+\s+\d+|\d+\s+[A-Za-z]+\s+\d{4})\s*[–-]\s*/, '')
		.trim();
	const explanationParagraph = [...content.querySelectorAll('p')]
		.find((paragraph) => paragraph.textContent.trim().startsWith('Explanation:'));
	const explanation = explanationParagraph
		? explanationParagraph.textContent.trim().replace(/^Explanation:\s*/, '')
		: 'No description is available for this entry.';
	const videoElement = content.querySelector('iframe[src], video[src], video source[src]');
	const apodImageLink = [...content.querySelectorAll('a[href]')]
		.find((link) => link.href.includes('/content/dam/science/cds/apod/'));
	const apodImage = [...content.querySelectorAll('img')]
		.find((image) => (image.getAttribute('src') || '').includes('/content/dam/science/cds/apod/'));
	const rawImageUrl = apodImageLink?.href || apodImage?.getAttribute('src');
	const videoLink = [...content.querySelectorAll('a[href]')]
		.find((link) => /youtube\.com|youtu\.be|vimeo\.com/i.test(link.href));
	const rawVideoUrl = videoElement?.getAttribute('src') || (!rawImageUrl ? videoLink?.href : '');
	const mediaType = rawVideoUrl ? 'video' : 'image';
	const mediaUrl = rawVideoUrl || rawImageUrl;

	return {
		date: post.date?.slice(0, 10),
		title: title || 'Untitled APOD',
		explanation,
		media_type: mediaType,
		url: mediaUrl ? new URL(mediaUrl, post.link).href : '',
		hdurl: mediaType === 'image' && mediaUrl ? new URL(mediaUrl, post.link).href : undefined
	};
}

function createGalleryItem(entry) {
	const item = document.createElement('article');
	item.className = 'gallery-item';

	const openButton = document.createElement('button');
	openButton.className = 'gallery-open';
	openButton.type = 'button';
	openButton.setAttribute('aria-label', `View ${entry.title || 'astronomy picture'} details`);

	const media = document.createElement('div');
	media.className = 'card-media';
	if (entry.media_type === 'video') {
		media.classList.add('video-preview');
		media.textContent = 'VIDEO';
		const playMark = document.createElement('span');
		playMark.className = 'play-mark';
		playMark.setAttribute('aria-hidden', 'true');
		playMark.textContent = '▶';
		media.append(playMark);
	} else {
		const imageUrl = entry.hdurl || entry.url;
		if (imageUrl) {
			const image = document.createElement('img');
			image.src = imageUrl;
			image.alt = entry.title || 'Astronomy picture';
			image.loading = 'lazy';
			image.addEventListener('error', () => {
				if (entry.hdurl && entry.url && image.src !== entry.url) {
					image.src = entry.url;
				} else {
					media.replaceChildren(document.createTextNode('Image unavailable'));
					media.classList.add('media-unavailable');
				}
			});
			media.append(image);
		} else {
			media.classList.add('media-unavailable');
			media.textContent = 'Image unavailable';
		}
	}

	const details = document.createElement('span');
	details.className = 'card-details';
	const title = document.createElement('span');
	title.className = 'card-title';
	title.textContent = entry.title || 'Untitled APOD';
	const date = document.createElement('span');
	date.className = 'card-date';
	date.textContent = formatDate(entry.date);
	details.append(title, date);
	openButton.append(media, details);
	openButton.addEventListener('click', () => openModal(entry, openButton));
	item.append(openButton);

	if (entry.media_type === 'video' && entry.url) {
		const videoLink = document.createElement('a');
		videoLink.className = 'video-link';
		videoLink.href = entry.url;
		videoLink.target = '_blank';
		videoLink.rel = 'noopener noreferrer';
		videoLink.textContent = 'Watch video';
		item.append(videoLink);
	}

	return item;
}

function formatDate(dateValue) {
	if (!dateValue) {
		return 'Date unavailable';
	}
	const parsedDate = new Date(`${dateValue}T00:00:00`);
	return Number.isNaN(parsedDate.getTime())
		? dateValue
		: parsedDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function openModal(entry, trigger) {
	modalMedia.replaceChildren();
	modalDate.textContent = formatDate(entry.date);
	modalTitle.textContent = entry.title || 'Untitled APOD';
	modalExplanation.textContent = entry.explanation || 'No description is available for this entry.';

	if (entry.media_type === 'video') {
		const videoMessage = document.createElement('p');
		videoMessage.className = 'modal-video-message';
		videoMessage.textContent = 'This APOD is a video.';
		modalMedia.append(videoMessage);
		if (entry.url) {
			const videoLink = document.createElement('a');
			videoLink.href = entry.url;
			videoLink.target = '_blank';
			videoLink.rel = 'noopener noreferrer';
			videoLink.textContent = 'Watch this video';
			modalMedia.append(videoLink);
		}
	} else {
		const imageUrl = entry.hdurl || entry.url;
		if (imageUrl) {
			const image = document.createElement('img');
			image.src = imageUrl;
			image.alt = entry.title || 'Astronomy picture';
			image.addEventListener('error', () => {
				if (entry.hdurl && entry.url && image.src !== entry.url) {
					image.src = entry.url;
				} else {
					image.remove();
					const unavailable = document.createElement('p');
					unavailable.textContent = 'Image unavailable.';
					modalMedia.append(unavailable);
				}
			});
			modalMedia.append(image);
		} else {
			const unavailable = document.createElement('p');
			unavailable.textContent = 'No image is available for this entry.';
			modalMedia.append(unavailable);
		}
	}

	modal.hidden = false;
	modal.setAttribute('aria-hidden', 'false');
	modalContent.focus();
	modal.dataset.triggerId = trigger.id || '';
	modal._trigger = trigger;
}

function closeModal() {
	modal.hidden = true;
	modal.setAttribute('aria-hidden', 'true');
	if (modal._trigger) {
		modal._trigger.focus();
	}
}

closeModalButton.addEventListener('click', closeModal);
modal.querySelector('[data-close-modal]').addEventListener('click', closeModal);
document.addEventListener('keydown', (event) => {
	if (event.key === 'Escape' && !modal.hidden) {
		closeModal();
	}
});
})();
