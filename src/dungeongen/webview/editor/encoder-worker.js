self.onmessage = (event) => {
	const { id, project } = event.data ?? {};
	try {
		const bytes = new TextEncoder().encode(JSON.stringify(project));
		let binary = '';
		const chunkSize = 0x8000;
		for (let offset = 0; offset < bytes.length; offset += chunkSize) {
			binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
		}
		self.postMessage({ id, base64: btoa(binary) });
	} catch (error) {
		self.postMessage({ id, error: error instanceof Error ? error.message : 'encodeFailed' });
	}
};
