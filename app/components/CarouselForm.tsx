'use client';

import { useState, useEffect, useRef } from 'react';
import {
  TextInput,
  Textarea,
  Button,
  Stack,
  Group,
  Paper,
  Title,
  Text,
  ActionIcon,
  Box,
  Switch,
  Accordion,
  Alert,
  Image,
  Card,
  Loader,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconTrash, IconVideo, IconInfoCircle, IconDownload } from '@tabler/icons-react';
import { TimePicker } from '@mantine/dates';
import { extractVideoId, timeToSeconds, secondsToTime, getVideoTitle } from '../utils/youtube';

interface Slide {
  topTime: string;
  bottomTime: string;
  topText: string;
  bottomText: string;
}

interface FormValues {
  name: string;
  youtubeUrl: string;
  showLogo: boolean;
  slides: Slide[];
}

interface GeneratedSlide {
  base64: string;
  filename: string;
}

export function CarouselForm() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedSlides, setGeneratedSlides] = useState<GeneratedSlide[]>([]);
  const [videoTitle, setVideoTitle] = useState<string>('');
  const [accordionValue, setAccordionValue] = useState<string | null>('slide-0');
  const generatedSlidesRef = useRef<HTMLDivElement>(null);

  const form = useForm<FormValues>({
    initialValues: {
      name: '',
      youtubeUrl: '',
      showLogo: true,
      slides: [
        {
          topTime: '00:00:00',
          bottomTime: '00:00:00',
          topText: '',
          bottomText: '',
        },
      ],
    },
    validate: {
      youtubeUrl: (value) => {
        const videoId = extractVideoId(value);
        return !videoId ? 'Valid YouTube URL or video ID is required' : null;
      },
      slides: {
        topTime: (value) => (!value ? 'Time is required' : null),
        bottomTime: (value) => (!value ? 'Time is required' : null),
        topText: (value) => (!value ? 'Text is required' : null),
        bottomText: (value) => (!value ? 'Text is required' : null),
      },
    },
  });

  useEffect(() => {
    const fetchVideoTitle = async () => {
      const videoId = extractVideoId(form.values.youtubeUrl);
      if (videoId) {
        const title = await getVideoTitle(videoId);
        if (title) {
          setVideoTitle(title);
          if (!form.values.name) {
            form.setFieldValue('name', title);
          }
        }
      }
    };
    
    if (form.values.youtubeUrl) {
      fetchVideoTitle();
    }
  }, [form.values.youtubeUrl]);

  const addSlide = () => {
    const newIndex = form.values.slides.length;
    form.insertListItem('slides', {
      topTime: '00:00:00',
      bottomTime: '00:00:00',
      topText: '',
      bottomText: '',
    });
    setAccordionValue(`slide-${newIndex}`);
  };

  const removeSlide = (index: number) => {
    form.removeListItem('slides', index);
  };

  const handleSubmit = async (values: FormValues) => {
    setIsGenerating(true);
    setGeneratedSlides([]);

    try {
      const videoId = extractVideoId(values.youtubeUrl);
      if (!videoId) {
        throw new Error('Invalid YouTube URL or video ID');
      }

      const payload = {
        name: values.name || videoTitle || 'carousel',
        videoId,
        showLogo: values.showLogo,
        slides: values.slides.map(slide => ({
          topTimestamp: timeToSeconds(slide.topTime),
          bottomTimestamp: timeToSeconds(slide.bottomTime),
          topText: slide.topText,
          bottomText: slide.bottomText,
        })),
      };

      const response = await fetch('/api/generate-carousel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Failed to generate carousel');
      }

      const data = await response.json();
      setGeneratedSlides(data.slides);

      setTimeout(() => {
        generatedSlidesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);

      notifications.show({
        title: 'Success!',
        message: `Generated ${data.slides.length} carousel slide${data.slides.length > 1 ? 's' : ''}`,
        color: 'teal',
      });
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to generate carousel',
        color: 'red',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadImage = (base64: string, filename: string) => {
    const link = document.createElement('a');
    link.href = base64;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <Box>
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="lg">
          <Paper p="md" withBorder>
            <Stack gap="md">
              <Title order={3}>Carousel Settings</Title>
              
              <TextInput
                label="YouTube URL or Video ID"
                placeholder="https://www.youtube.com/watch?v=dQw4w9WgXcQ or dQw4w9WgXcQ"
                description="Paste a YouTube URL or just the video ID"
                required
                leftSection={<IconVideo size={16} />}
                {...form.getInputProps('youtubeUrl')}
              />

              {videoTitle && (
                <Alert color="blue" variant="light">
                  <Text size="sm" fw={500}>Video: {videoTitle}</Text>
                </Alert>
              )}

              <TextInput
                label="Carousel Name (Optional)"
                placeholder={videoTitle || "Will default to video title"}
                description="Leave empty to use video title"
                {...form.getInputProps('name')}
              />

              <Switch
                label="Show Logo"
                description="Display your logo on the carousel slides"
                {...form.getInputProps('showLogo', { type: 'checkbox' })}
              />
            </Stack>
          </Paper>

          <Paper p="md" withBorder>
            <Stack gap="md">
              <Group justify="space-between">
                <Title order={3}>Slides ({form.values.slides.length})</Title>
                <Button
                  leftSection={<IconPlus size={16} />}
                  onClick={addSlide}
                  variant="light"
                  size="sm"
                >
                  Add Slide
                </Button>
              </Group>

              <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
                Each slide shows two video frames stacked vertically with text overlays.
                Enter timestamps in HH:MM:SS format.
              </Alert>

              <Accordion variant="separated" value={accordionValue} onChange={setAccordionValue}>
                {form.values.slides.map((slide, index) => (
                  <Accordion.Item key={index} value={`slide-${index}`}>
                    <Accordion.Control>
                      <Group justify="space-between" wrap="nowrap">
                        <Text fw={500}>Slide {index + 1}</Text>
                        {form.values.slides.length > 1 && (
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeSlide(index);
                            }}
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        )}
                      </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="sm">
                        <TimePicker
                          label="Top Frame Timestamp"
                          withSeconds
                          required
                          {...form.getInputProps(`slides.${index}.topTime`)}
                        />

                        <Textarea
                          label="Top Frame Text"
                          placeholder="Enter text for top frame"
                          required
                          minRows={2}
                          {...form.getInputProps(`slides.${index}.topText`)}
                        />

                        <TimePicker
                          label="Bottom Frame Timestamp"
                          withSeconds
                          required
                          {...form.getInputProps(`slides.${index}.bottomTime`)}
                        />

                        <Textarea
                          label="Bottom Frame Text"
                          placeholder="Enter text for bottom frame"
                          required
                          minRows={2}
                          {...form.getInputProps(`slides.${index}.bottomText`)}
                        />
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                ))}
              </Accordion>
            </Stack>
          </Paper>

          <Button
            type="submit"
            size="lg"
            loading={isGenerating}
            fullWidth
            disabled={isGenerating}
          >
            {isGenerating ? (
              <Group gap="xs">
                <Loader size="sm" color="white" />
                <span>Generating Carousel...</span>
              </Group>
            ) : (
              'Generate Carousel'
            )}
          </Button>

          {generatedSlides.length > 0 && (
            <Paper p="md" withBorder ref={generatedSlidesRef}>
              <Stack gap="md">
                <Title order={4}>Generated Carousel Slides</Title>
                <Stack gap="lg">
                  {generatedSlides.map((slide, index) => (
                    <Card key={index} shadow="sm" padding="lg" radius="md" withBorder>
                      <Card.Section>
                        <Image
                          src={slide.base64}
                          alt={`Slide ${index + 1}`}
                          fit="contain"
                        />
                      </Card.Section>
                      <Group justify="space-between" mt="md">
                        <Text fw={500}>Slide {index + 1}</Text>
                        <Button
                          leftSection={<IconDownload size={16} />}
                          variant="light"
                          onClick={() => downloadImage(slide.base64, slide.filename)}
                        >
                          Download PNG
                        </Button>
                      </Group>
                    </Card>
                  ))}
                </Stack>
              </Stack>
            </Paper>
          )}
        </Stack>
      </form>
    </Box>
  );
}
