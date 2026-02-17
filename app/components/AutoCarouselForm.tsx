'use client';

import { useState, useRef } from 'react';
import {
  TextInput,
  Button,
  Stack,
  Group,
  Paper,
  Title,
  Text,
  NumberInput,
  Alert,
  Image,
  Accordion,
  Textarea,
  ColorInput,
  Checkbox,
  Badge,
  ActionIcon,
  Tooltip,
  Select,
  Box,
  Menu,
  Modal,
  CopyButton,
  Code,
} from '@mantine/core';
import { Carousel } from '@mantine/carousel';
import { notifications } from '@mantine/notifications';
import {
  IconWand,
  IconRocket,
  IconDownload,
  IconBrandInstagram,
  IconBrandYoutube,
  IconBrandTiktok,
  IconBrandLinkedin,
  IconBrandSpotify,
  IconBrandApple,
  IconFileZip,
  IconPhoto,
  IconChevronDown,
  IconClipboard,
  IconCheck,
  IconArrowRight,
} from '@tabler/icons-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { extractVideoId, getVideoTitle } from '../utils/youtube';

interface SlideData {
  topTimestamp: number;
  bottomTimestamp: number;
  topText: string;
  bottomText: string;
}

interface CarouselSuggestion {
  carouselTitle: string;
  slides: SlideData[];
}

interface GeneratedSlide {
  base64: string;
  filename: string;
}

interface GeneratedCarousel {
  title: string;
  slides: GeneratedSlide[];
}

const CTA_PRESETS = [
  { value: 'follow', label: 'Follow us for more' },
  { value: 'stream', label: 'Stream our latest episode on' },
  { value: 'custom', label: 'Custom text' },
];

const PLATFORM_OPTIONS = [
  { id: 'instagram', label: 'Instagram', icon: IconBrandInstagram },
  { id: 'youtube', label: 'YouTube', icon: IconBrandYoutube },
  { id: 'tiktok', label: 'TikTok', icon: IconBrandTiktok },
  { id: 'linkedin', label: 'LinkedIn', icon: IconBrandLinkedin },
  { id: 'spotify', label: 'Spotify', icon: IconBrandSpotify },
  { id: 'apple', label: 'Apple Podcasts', icon: IconBrandApple },
];

const BG_COLOR_PRESETS = [
  { color: '#1a1a2e', label: 'Dark Navy' },
  { color: '#0f0f0f', label: 'Black' },
  { color: '#fc8b94', label: 'Coral Pink' },
  { color: '#a2d4d1', label: 'Mint Green' },
  { color: '#2d3436', label: 'Charcoal' },
  { color: '#6c5ce7', label: 'Purple' },
];

export function AutoCarouselForm() {
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [numCarousels, setNumCarousels] = useState<number>(3);
  const [slidesPerCarousel, setSlidesPerCarousel] = useState<number>(5);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingIndex, setGeneratingIndex] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<CarouselSuggestion[]>([]);
  const [generatedCarousels, setGeneratedCarousels] = useState<GeneratedCarousel[]>([]);
  const [urlError, setUrlError] = useState<string | null>(null);

  // CTA config
  const [ctaPreset, setCtaPreset] = useState<string>('follow');
  const [ctaCustomText, setCtaCustomText] = useState('');
  const [ctaHandle, setCtaHandle] = useState('@ragtech');
  const [ctaPlatforms, setCtaPlatforms] = useState<string[]>(['instagram', 'youtube']);
  const [ctaBgColor, setCtaBgColor] = useState('#1a1a2e');
  const [includeCtaSlide, setIncludeCtaSlide] = useState(true);

  const generatedRef = useRef<HTMLDivElement>(null);

  // Manual mode state (local testing without API key)
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualPrompt, setManualPrompt] = useState('');
  const [manualResponse, setManualResponse] = useState('');
  const [manualMaxTimestamp, setManualMaxTimestamp] = useState(3600);

  const handleUrlChange = async (url: string) => {
    setYoutubeUrl(url);
    const videoId = extractVideoId(url);
    if (videoId) {
      setUrlError(null);
      const title = await getVideoTitle(videoId);
      if (title) setVideoTitle(title);
    } else if (url) {
      setUrlError('Valid YouTube URL or video ID is required');
      setVideoTitle('');
    }
  };

  const getCtaText = () => {
    if (ctaPreset === 'custom') return ctaCustomText;
    if (ctaPreset === 'follow') return `Follow us for more ${ctaHandle}`;
    if (ctaPreset === 'stream') return `Stream our latest episode on`;
    return '';
  };

  const handleAnalyze = async () => {
    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) {
      setUrlError('Valid YouTube URL or video ID is required');
      return;
    }

    setIsAnalyzing(true);
    setSuggestions([]);
    setGeneratedCarousels([]);

    try {
      const response = await fetch('/api/auto-carousel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, numCarousels, slidesPerCarousel }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to analyze video');
      }

      const data = await response.json();

      // Production mode: carousels returned directly
      if (data.success && data.carousels) {
        setSuggestions(data.carousels || []);
        if (data.carousels.length > 0) {
          notifications.show({
            title: 'Analysis Complete',
            message: `Found ${data.carousels.length} carousel suggestions with ${data.carousels[0]?.slides?.length || 0} slides each`,
            color: 'teal',
          });
        }
        return;
      }

      // Manual mode: need user to paste Claude response
      if (data.mode === 'manual') {
        setManualPrompt(data.prompt);
        setManualResponse('');
        setManualMaxTimestamp(data.maxTimestamp || 3600);
        setManualModalOpen(true);
        notifications.show({
          title: 'Manual Mode',
          message: 'No API key configured. Copy the prompt into Claude and paste the response back.',
          color: 'blue',
        });
        return;
      }

      notifications.show({
        title: 'No Suggestions',
        message: 'Could not find suitable segments. Try a different video.',
        color: 'yellow',
      });
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to analyze video',
        color: 'red',
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleManualSubmit = async () => {
    if (!manualResponse.trim()) {
      notifications.show({ title: 'Error', message: 'Please paste the Claude response', color: 'red' });
      return;
    }

    setIsAnalyzing(true);

    try {
      const response = await fetch('/api/auto-carousel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'build',
          llmResponse: manualResponse,
          maxTimestamp: manualMaxTimestamp,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to build carousels');
      }

      const data = await response.json();

      if (data.success && data.carousels) {
        setSuggestions(data.carousels);
        setManualModalOpen(false);
        notifications.show({
          title: 'Analysis Complete',
          message: `Built ${data.carousels.length} carousels from transcript`,
          color: 'teal',
        });
      }
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to process response',
        color: 'red',
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGenerate = async (carouselIndex: number) => {
    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) return;

    const carousel = suggestions[carouselIndex];
    if (!carousel) return;

    setGeneratingIndex(carouselIndex);
    setIsGenerating(true);

    try {
      const ctaConfig = includeCtaSlide
        ? {
            text: getCtaText(),
            bgColor: ctaBgColor,
            platforms: ctaPlatforms,
            thumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          }
        : null;

      const response = await fetch('/api/generate-carousel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: carousel.carouselTitle.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '-').toLowerCase(),
          videoId,
          showLogo: true,
          slides: carousel.slides,
          ctaSlide: ctaConfig,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate carousel');
      }

      const data = await response.json();
      const newCarousel: GeneratedCarousel = {
        title: carousel.carouselTitle,
        slides: data.slides || [],
      };

      setGeneratedCarousels((prev) => [...prev, newCarousel]);

      notifications.show({
        title: 'Carousel Generated!',
        message: `"${carousel.carouselTitle}" — ${data.slides?.length || 0} slides`,
        color: 'teal',
      });

      setTimeout(() => {
        generatedRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 300);
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to generate carousel',
        color: 'red',
      });
    } finally {
      setIsGenerating(false);
      setGeneratingIndex(null);
    }
  };

  const formatTimestamp = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const togglePlatform = (platformId: string) => {
    setCtaPlatforms((prev) =>
      prev.includes(platformId)
        ? prev.filter((p) => p !== platformId)
        : [...prev, platformId]
    );
  };

  const downloadSlide = (slide: GeneratedSlide) => {
    const link = document.createElement('a');
    link.href = slide.base64;
    link.download = slide.filename;
    link.click();
  };

  const downloadCarouselAsZip = async (gc: GeneratedCarousel) => {
    const zip = new JSZip();
    const folderName = gc.title.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '-').toLowerCase();
    const folder = zip.folder(folderName);
    if (!folder) return;

    for (const slide of gc.slides) {
      const base64Data = slide.base64.replace(/^data:image\/png;base64,/, '');
      folder.file(slide.filename, base64Data, { base64: true });
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, `${folderName}.zip`);
  };

  const downloadAllAsZip = async () => {
    const zip = new JSZip();

    for (const gc of generatedCarousels) {
      const folderName = gc.title.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '-').toLowerCase();
      const folder = zip.folder(folderName);
      if (!folder) continue;

      for (const slide of gc.slides) {
        const base64Data = slide.base64.replace(/^data:image\/png;base64,/, '');
        folder.file(slide.filename, base64Data, { base64: true });
      }
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    saveAs(blob, 'deckcreate-carousels.zip');
  };

  return (
    <Stack gap="lg">
      {/* Manual Mode Modal */}
      <Modal
        opened={manualModalOpen}
        onClose={() => setManualModalOpen(false)}
        title="Manual Claude Processing"
        size="xl"
        closeOnClickOutside={false}
      >
        <Stack gap="md">
          <Alert color="blue" variant="light">
            <Text size="sm" fw={500}>
              Copy the prompt below, paste it into Claude (claude.ai), then paste Claude&apos;s JSON response back here.
            </Text>
          </Alert>

          <Box>
            <Group justify="space-between" mb={4}>
              <Text size="sm" fw={500}>Prompt to send to Claude:</Text>
              <CopyButton value={manualPrompt}>
                {({ copied, copy }) => (
                  <Button
                    size="xs"
                    variant="light"
                    color={copied ? 'teal' : 'blue'}
                    leftSection={copied ? <IconCheck size={14} /> : <IconClipboard size={14} />}
                    onClick={copy}
                  >
                    {copied ? 'Copied!' : 'Copy Prompt'}
                  </Button>
                )}
              </CopyButton>
            </Group>
            <Code block style={{ maxHeight: 200, overflow: 'auto', fontSize: 11 }}>
              {manualPrompt.length > 2000
                ? manualPrompt.substring(0, 2000) + `\n\n... (${manualPrompt.length} chars total — use the Copy button above)`
                : manualPrompt}
            </Code>
          </Box>

          <Textarea
            label="Paste Claude's response here:"
            placeholder="Paste the JSON response from Claude..."
            minRows={8}
            maxRows={15}
            autosize
            value={manualResponse}
            onChange={(e) => setManualResponse(e.currentTarget.value)}
          />

          <Group justify="flex-end">
            <Button
              variant="light"
              onClick={() => setManualModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleManualSubmit}
              loading={isAnalyzing}
              rightSection={<IconArrowRight size={16} />}
            >
              Build Carousels
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Video Input */}
      <Paper p="md" withBorder>
        <Stack gap="md">
          <Group gap="sm">
            <Title order={3}>Auto Bulk Carousel</Title>
            <Badge color="violet" variant="light" size="sm">Pro</Badge>
          </Group>
          <Text size="sm" c="dimmed">
            Paste a YouTube link and our LLM will analyze the transcript to find the best
            segments for carousel posts — complete with attention-grabbing hooks.
          </Text>

          <TextInput
            label="YouTube URL or Video ID"
            placeholder="https://www.youtube.com/watch?v=..."
            required
            value={youtubeUrl}
            onChange={(e) => handleUrlChange(e.currentTarget.value)}
            error={urlError}
          />

          {videoTitle && (
            <Alert color="blue" variant="light">
              <Text size="sm" fw={500}>Video: {videoTitle}</Text>
            </Alert>
          )}

          <Group grow>
            <NumberInput
              label="Number of carousels"
              min={1}
              max={10}
              value={numCarousels}
              onChange={(val) => setNumCarousels(Number(val) || 3)}
            />
            <NumberInput
              label="Slides per carousel"
              min={3}
              max={10}
              value={slidesPerCarousel}
              onChange={(val) => setSlidesPerCarousel(Number(val) || 5)}
            />
          </Group>
        </Stack>
      </Paper>

      {/* CTA Slide Config */}
      <Paper p="md" withBorder>
        <Stack gap="md">
          <Group justify="space-between">
            <Title order={4}>Call-to-Action Slide</Title>
            <Checkbox
              label="Include CTA slide"
              checked={includeCtaSlide}
              onChange={(e) => setIncludeCtaSlide(e.currentTarget.checked)}
            />
          </Group>

          {includeCtaSlide && (
            <>
              <Select
                label="CTA Type"
                data={CTA_PRESETS}
                value={ctaPreset}
                onChange={(val) => setCtaPreset(val || 'follow')}
              />

              {ctaPreset === 'follow' && (
                <TextInput
                  label="Handle"
                  placeholder="@yourhandle"
                  value={ctaHandle}
                  onChange={(e) => setCtaHandle(e.currentTarget.value)}
                />
              )}

              {ctaPreset === 'custom' && (
                <Textarea
                  label="Custom CTA Text"
                  placeholder="Your custom call-to-action text..."
                  value={ctaCustomText}
                  onChange={(e) => setCtaCustomText(e.currentTarget.value)}
                  minRows={2}
                />
              )}

              <Box>
                <Text size="sm" fw={500} mb="xs">
                  {ctaPreset === 'stream' ? 'Streaming platforms' : 'Social platforms'}
                </Text>
                <Group gap="xs">
                  {PLATFORM_OPTIONS.map((platform) => {
                    const Icon = platform.icon;
                    const isSelected = ctaPlatforms.includes(platform.id);
                    return (
                      <Tooltip key={platform.id} label={platform.label}>
                        <ActionIcon
                          size="lg"
                          variant={isSelected ? 'filled' : 'light'}
                          color={isSelected ? 'primary' : 'gray'}
                          onClick={() => togglePlatform(platform.id)}
                        >
                          <Icon size={18} />
                        </ActionIcon>
                      </Tooltip>
                    );
                  })}
                </Group>
              </Box>

              <Box>
                <Text size="sm" fw={500} mb="xs">Background Color</Text>
                <Group gap="xs" mb="xs">
                  {BG_COLOR_PRESETS.map((preset) => (
                    <Tooltip key={preset.color} label={preset.label}>
                      <ActionIcon
                        size="lg"
                        variant="filled"
                        style={{
                          backgroundColor: preset.color,
                          border: ctaBgColor === preset.color
                            ? '3px solid var(--mantine-color-primary-6)'
                            : '2px solid var(--mantine-color-default-border)',
                        }}
                        onClick={() => setCtaBgColor(preset.color)}
                      >
                        {ctaBgColor === preset.color && (
                          <Box style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'white' }} />
                        )}
                      </ActionIcon>
                    </Tooltip>
                  ))}
                </Group>
                <ColorInput
                  size="xs"
                  value={ctaBgColor}
                  onChange={setCtaBgColor}
                  format="hex"
                />
              </Box>
            </>
          )}
        </Stack>
      </Paper>

      {/* Analyze Button */}
      <Button
        size="lg"
        fullWidth
        loading={isAnalyzing}
        disabled={isAnalyzing || !youtubeUrl}
        onClick={handleAnalyze}
        leftSection={<IconWand size={20} />}
        color="violet"
      >
        {isAnalyzing ? 'Analyzing transcript with LLM...' : 'Analyze Video & Generate Suggestions'}
      </Button>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <Paper p="md" withBorder>
          <Stack gap="md">
            <Title order={4}>Carousel Suggestions ({suggestions.length})</Title>
            <Text size="xs" c="dimmed">
              Review the AI-suggested carousels below. Edit any text, then click Generate to create the slides.
            </Text>

            <Accordion variant="separated">
              {suggestions.map((carousel, cIdx) => (
                <Accordion.Item key={cIdx} value={`carousel-${cIdx}`}>
                  <Accordion.Control>
                    <Group gap="sm">
                      <Badge color="violet" variant="light" size="sm">
                        {carousel.slides.length} slides
                      </Badge>
                      <Text fw={500} size="sm">{carousel.carouselTitle}</Text>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <Stack gap="sm">
                      {carousel.slides.map((slide, sIdx) => (
                        <Paper key={sIdx} p="sm" withBorder radius="sm">
                          <Group justify="space-between" mb="xs">
                            <Badge size="xs" variant="light" color={sIdx === 0 ? 'orange' : 'gray'}>
                              {sIdx === 0 ? 'Hook Slide' : `Slide ${sIdx + 1}`}
                            </Badge>
                            <Text size="xs" c="dimmed">
                              {formatTimestamp(slide.topTimestamp)} – {formatTimestamp(slide.bottomTimestamp)}
                            </Text>
                          </Group>
                          <Stack gap={4}>
                            <Textarea
                              size="xs"
                              label="Top text"
                              minRows={1}
                              autosize
                              value={slide.topText}
                              onChange={(e) => {
                                const updated = [...suggestions];
                                updated[cIdx].slides[sIdx].topText = e.currentTarget.value;
                                setSuggestions(updated);
                              }}
                            />
                            <Textarea
                              size="xs"
                              label="Bottom text"
                              minRows={1}
                              autosize
                              value={slide.bottomText}
                              onChange={(e) => {
                                const updated = [...suggestions];
                                updated[cIdx].slides[sIdx].bottomText = e.currentTarget.value;
                                setSuggestions(updated);
                              }}
                            />
                          </Stack>
                        </Paper>
                      ))}

                      <Button
                        fullWidth
                        color="violet"
                        loading={isGenerating && generatingIndex === cIdx}
                        disabled={isGenerating}
                        onClick={() => handleGenerate(cIdx)}
                        leftSection={<IconRocket size={16} />}
                      >
                        Generate This Carousel
                      </Button>
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              ))}
            </Accordion>
          </Stack>
        </Paper>
      )}

      {/* Generated Carousels */}
      {generatedCarousels.length > 0 && (
        <Stack gap="lg" ref={generatedRef}>
          <Paper p="md" withBorder>
            <Group justify="space-between" mb="md">
              <Title order={4}>Generated Carousels ({generatedCarousels.length})</Title>
              <Menu shadow="md" width={200}>
                <Menu.Target>
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<IconDownload size={14} />}
                    rightSection={<IconChevronDown size={12} />}
                  >
                    Download All
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    leftSection={<IconFileZip size={14} />}
                    onClick={downloadAllAsZip}
                  >
                    Download as ZIP
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconPhoto size={14} />}
                    onClick={() => {
                      generatedCarousels.forEach((gc) =>
                        gc.slides.forEach((s) => downloadSlide(s))
                      );
                    }}
                  >
                    Download individually
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          </Paper>

          {generatedCarousels.map((gc, gcIdx) => (
            <Paper key={gcIdx} p="md" withBorder>
              <Stack gap="md">
                <Group justify="space-between">
                  <Group gap="sm">
                    <Badge color="violet" variant="light" size="sm">
                      Carousel {gcIdx + 1}
                    </Badge>
                    <Text fw={600} size="sm">{gc.title}</Text>
                  </Group>
                  <Menu shadow="md" width={200}>
                    <Menu.Target>
                      <Button
                        size="xs"
                        variant="subtle"
                        leftSection={<IconDownload size={14} />}
                        rightSection={<IconChevronDown size={12} />}
                      >
                        Download
                      </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item
                        leftSection={<IconFileZip size={14} />}
                        onClick={() => downloadCarouselAsZip(gc)}
                      >
                        Download as ZIP
                      </Menu.Item>
                      <Menu.Item
                        leftSection={<IconPhoto size={14} />}
                        onClick={() => gc.slides.forEach((s) => downloadSlide(s))}
                      >
                        Download individually
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                </Group>

                <Carousel
                  withIndicators
                  withControls
                  slideSize="70%"
                  slideGap="md"
                  emblaOptions={{ loop: true, align: 'center' }}
                  styles={{
                    control: {
                      backgroundColor: 'var(--mantine-color-body)',
                      border: '1px solid var(--mantine-color-default-border)',
                      boxShadow: 'var(--mantine-shadow-sm)',
                    },
                  }}
                >
                  {gc.slides.map((slide, sIdx) => (
                    <Carousel.Slide key={sIdx}>
                      <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
                        <Image src={slide.base64} alt={`${gc.title} - Slide ${sIdx + 1}`} />
                        <Group p="xs" justify="space-between">
                          <Text size="xs" c="dimmed">
                            {sIdx === gc.slides.length - 1 && includeCtaSlide ? 'CTA Slide' : `Slide ${sIdx + 1}`}
                          </Text>
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            onClick={() => downloadSlide(slide)}
                          >
                            <IconDownload size={14} />
                          </ActionIcon>
                        </Group>
                      </Paper>
                    </Carousel.Slide>
                  ))}
                </Carousel>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
