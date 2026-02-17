'use client';

import { useState, useEffect } from 'react';
import {
  TextInput,
  Button,
  Stack,
  Group,
  Paper,
  Title,
  Text,
  Switch,
  Alert,
  Loader,
  CopyButton,
  ActionIcon,
  Tooltip,
  SegmentedControl,
  Box,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { TimePicker } from '@mantine/dates';
import { IconVideo, IconInfoCircle, IconCopy, IconCheck, IconFileText } from '@tabler/icons-react';
import { extractVideoId, timeToSeconds, getVideoTitle } from '../utils/youtube';

interface Sentence {
  timestamp: number;
  text: string;
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function TranscriptionForm() {
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [videoTitle, setVideoTitle] = useState<string>('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [removeFillers, setRemoveFillers] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [rangeMode, setRangeMode] = useState<string>('full');
  const [startTime, setStartTime] = useState('00:00:00');
  const [endTime, setEndTime] = useState('00:00:00');
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [fullText, setFullText] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTitle = async () => {
      const videoId = extractVideoId(youtubeUrl);
      if (videoId) {
        setUrlError(null);
        const title = await getVideoTitle(videoId);
        if (title) setVideoTitle(title);
      } else if (youtubeUrl) {
        setUrlError('Valid YouTube URL or video ID is required');
        setVideoTitle('');
      }
    };

    if (youtubeUrl) {
      fetchTitle();
    } else {
      setVideoTitle('');
      setUrlError(null);
    }
  }, [youtubeUrl]);

  const handleTranscribe = async () => {
    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) {
      setUrlError('Valid YouTube URL or video ID is required');
      return;
    }

    if (rangeMode === 'range') {
      if (!startTime || startTime === '00:00:00') {
        notifications.show({ title: 'Error', message: 'Please enter a start time', color: 'red' });
        return;
      }
    }

    setIsTranscribing(true);
    setSentences([]);
    setFullText('');

    try {
      const payload: Record<string, unknown> = { videoId, removeFillers };

      if (rangeMode === 'range') {
        payload.startTime = timeToSeconds(startTime);
        if (endTime && endTime !== '00:00:00') {
          payload.endTime = timeToSeconds(endTime);
        }
      }

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to transcribe');
      }

      const data = await response.json();
      setSentences(data.sentences || []);
      setFullText(data.fullText || '');

      if (data.sentences?.length > 0) {
        notifications.show({
          title: 'Transcription Complete',
          message: `Extracted ${data.sentences.length} sentences`,
          color: 'teal',
        });
      } else {
        notifications.show({
          title: 'No Captions Found',
          message: 'This video may not have auto-generated captions.',
          color: 'yellow',
        });
      }
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to transcribe video',
        color: 'red',
      });
    } finally {
      setIsTranscribing(false);
    }
  };

  const getDisplayText = () => {
    if (showTimestamps) {
      return sentences.map((s) => `[${formatTimestamp(s.timestamp)}] ${s.text}`).join('\n\n');
    }
    return fullText;
  };

  return (
    <Box>
      <Stack gap="lg">
        <Paper p="md" withBorder>
          <Stack gap="md">
            <Title order={3}>Video</Title>

            <TextInput
              label="YouTube URL or Video ID"
              placeholder="https://www.youtube.com/watch?v=dQw4w9WgXcQ or dQw4w9WgXcQ"
              description="Paste a YouTube URL or just the video ID"
              required
              leftSection={<IconVideo size={16} />}
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.currentTarget.value)}
              error={urlError}
            />

            {videoTitle && (
              <Alert color="blue" variant="light">
                <Text size="sm" fw={500}>Video: {videoTitle}</Text>
              </Alert>
            )}
          </Stack>
        </Paper>

        <Paper p="md" withBorder>
          <Stack gap="md">
            <Title order={3}>Options</Title>

            <SegmentedControl
              value={rangeMode}
              onChange={setRangeMode}
              data={[
                { label: 'Full Video', value: 'full' },
                { label: 'Custom Range', value: 'range' },
              ]}
              fullWidth
            />

            {rangeMode === 'range' && (
              <Group grow>
                <TimePicker
                  label="Start Time"
                  withSeconds
                  value={startTime}
                  onChange={(val) => setStartTime(val as string)}
                />
                <TimePicker
                  label="End Time (optional)"
                  description="Leave at 00:00:00 for end of video"
                  withSeconds
                  value={endTime}
                  onChange={(val) => setEndTime(val as string)}
                />
              </Group>
            )}

            <Group>
              <Switch
                label="Remove filler words"
                description="Strip out uh, um, er, etc."
                checked={removeFillers}
                onChange={(e) => setRemoveFillers(e.currentTarget.checked)}
              />
            </Group>
          </Stack>
        </Paper>

        <Button
          size="lg"
          loading={isTranscribing}
          fullWidth
          disabled={isTranscribing || !youtubeUrl}
          onClick={handleTranscribe}
          leftSection={<IconFileText size={20} />}
        >
          {isTranscribing ? (
            <Group gap="xs">
              <Loader size="sm" color="white" />
              <span>Transcribing...</span>
            </Group>
          ) : (
            'Transcribe Video'
          )}
        </Button>

        {sentences.length > 0 && (
          <Paper p="md" withBorder>
            <Stack gap="md">
              <Group justify="space-between">
                <Title order={4}>Transcription ({sentences.length} sentences)</Title>
                <Group gap="sm">
                  <Switch
                    label="Show timestamps"
                    size="xs"
                    checked={showTimestamps}
                    onChange={(e) => setShowTimestamps(e.currentTarget.checked)}
                  />
                  <CopyButton value={getDisplayText()} timeout={2000}>
                    {({ copied, copy }) => (
                      <Tooltip label={copied ? 'Copied!' : 'Copy to clipboard'}>
                        <ActionIcon color={copied ? 'teal' : 'gray'} variant="subtle" onClick={copy}>
                          {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </CopyButton>
                </Group>
              </Group>

              <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
                Click the copy button to copy the full transcription. Toggle timestamps on/off for your preferred format.
              </Alert>

              <Paper
                p="md"
                withBorder
                style={{
                  maxHeight: '500px',
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  fontFamily: 'monospace',
                  fontSize: '0.875rem',
                  lineHeight: 1.7,
                }}
              >
                {showTimestamps
                  ? sentences.map((s, i) => (
                      <Box key={i} mb="xs">
                        <Text component="span" c="dimmed" size="xs" ff="monospace">
                          [{formatTimestamp(s.timestamp)}]
                        </Text>{' '}
                        <Text component="span" size="sm">
                          {s.text}
                        </Text>
                      </Box>
                    ))
                  : <Text size="sm" style={{ lineHeight: 1.8 }}>{fullText}</Text>
                }
              </Paper>
            </Stack>
          </Paper>
        )}
      </Stack>
    </Box>
  );
}
