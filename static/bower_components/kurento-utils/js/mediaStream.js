// run this in the browser console.
function buildJSON(streams) {
    clear();
    var mock = []

    var mockTrack = (stream) => {
        const output = stream.reduce((acc, next) => {
            const clone = {}
            for (var i in next) {
                if (typeof next[i] === 'string' || typeof next[i] === 'boolean') {
                    clone[i] = next[i]
                }
            }
            const settings = next.getSettings()
            clone.getSettings = JSON.stringify(settings)
            clone.stop = 'MOCK_FUNCTION'
            acc.push(clone)
            return acc
        }, [])
        return `${JSON.stringify(output)}`
    }

    streams.forEach((stream) => {
        mock.push({
            id: stream.id,
            active: stream.active,
            getTracks: mockTrack(stream.getTracks()),
            getAudioTracks: mockTrack(stream.getAudioTracks()),
            getVideoTracks: mockTrack(stream.getVideoTracks()),
            onactive: Function.prototype,
            onaddtrack: Function.prototype,
            oninactive: Function.prototype,
            onremovetrack: Function.prototype,
        })
        console.dir(mock)
        copy(mock)
    })
}

// buildJSON(mediaStreams)