import { Container, Title, Text, Stack, Group, Paper, Button, Badge, ThemeIcon, SimpleGrid, Box, Anchor } from '@mantine/core';
import { IconPhoto, IconFileText, IconLeaf, IconSparkles, IconArrowRight, IconBrandYoutube, IconWand, IconLock } from '@tabler/icons-react';
import { Header } from './components/Header';
import { InstagramEmbed } from './components/InstagramEmbed';

export default function Home() {
  return (
    <div style={{ minHeight: '100vh', paddingBottom: '3rem' }}>
      <Header />

      <Container size="md" px="md">
        <Stack gap={48}>

          {/* Hero */}
          <Stack gap="md" align="center" ta="center" py="xl">
            <Badge size="lg" variant="light" color="secondary" leftSection={<IconLeaf size={14} />}>
              Minimal AI. Low carbon footprint. Your authentic content.
            </Badge>
            <Title
              order={1}
              style={{
                fontSize: 'clamp(1.75rem, 4vw, 2.75rem)',
                fontWeight: 800,
                lineHeight: 1.2,
              }}
            >
              Repurpose your long-form videos
              <br />
              <Text
                component="span"
                inherit
                style={{
                  background: 'linear-gradient(135deg, #fc8b94 0%, #a2d4d1 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                into scroll-stopping content
              </Text>
            </Title>
            <Text size="lg" c="dimmed" maw={560}>
              You already put the work into creating authentic long-form content.
              Deckcreate helps you get more from it — turning YouTube videos into
              carousels and transcriptions, so you can focus on what you do best: creating.
            </Text>
          </Stack>

          {/* Tool Cards */}
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">

            {/* Carousel Generator Card */}
            <Paper p="xl" withBorder radius="lg" style={{ display: 'flex', flexDirection: 'column' }}>
              <Stack gap="md" style={{ flex: 1 }}>
                <Group>
                  <ThemeIcon size={48} radius="md" variant="light" color="primary">
                    <IconPhoto size={24} />
                  </ThemeIcon>
                </Group>
                <Title order={4}>Carousel Generator</Title>
                <Text size="sm" c="dimmed" style={{ flex: 1 }}>
                  Extract frames from your YouTube videos and overlay captions to create
                  carousel slides for Instagram, TikTok, and LinkedIn.
                </Text>
                <Group gap="xs" wrap="wrap">
                  <Badge size="xs" variant="dot" color="primary">Frame extraction</Badge>
                  <Badge size="xs" variant="dot" color="secondary">Auto-captions</Badge>
                </Group>
                <Anchor href="/carousel" underline="never">
                  <Button
                    fullWidth
                    size="md"
                    rightSection={<IconArrowRight size={16} />}
                  >
                    Create Carousel
                  </Button>
                </Anchor>
              </Stack>
            </Paper>

            {/* Transcription Card */}
            <Paper p="xl" withBorder radius="lg" style={{ display: 'flex', flexDirection: 'column' }}>
              <Stack gap="md" style={{ flex: 1 }}>
                <Group>
                  <ThemeIcon size={48} radius="md" variant="light" color="secondary">
                    <IconFileText size={24} />
                  </ThemeIcon>
                </Group>
                <Title order={4}>Video Transcription</Title>
                <Text size="sm" c="dimmed" style={{ flex: 1 }}>
                  Get a full transcription of any YouTube video with per-sentence timestamps
                  and automatic filler word removal.
                </Text>
                <Group gap="xs" wrap="wrap">
                  <Badge size="xs" variant="dot" color="primary">Timestamps</Badge>
                  <Badge size="xs" variant="dot" color="secondary">Filler removal</Badge>
                </Group>
                <Anchor href="/transcribe" underline="never">
                  <Button
                    fullWidth
                    size="md"
                    variant="light"
                    rightSection={<IconArrowRight size={16} />}
                  >
                    Transcribe Video
                  </Button>
                </Anchor>
              </Stack>
            </Paper>

            {/* Auto Carousel Pro Card */}
            <Paper
              p="xl"
              withBorder
              radius="lg"
              style={{
                display: 'flex',
                flexDirection: 'column',
                borderColor: 'var(--mantine-color-violet-4)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <Badge
                color="violet"
                variant="filled"
                size="sm"
                style={{ position: 'absolute', top: 12, right: 12 }}
              >
                Pro
              </Badge>
              <Stack gap="md" style={{ flex: 1 }}>
                <Group>
                  <ThemeIcon size={48} radius="md" variant="light" color="violet">
                    <IconWand size={24} />
                  </ThemeIcon>
                </Group>
                <Title order={4}>Auto Bulk Carousel</Title>
                <Text size="sm" c="dimmed" style={{ flex: 1 }}>
                  Paste a link and let our LLM analyze the transcript to auto-generate
                  multiple carousels with hooks and CTA slides.
                </Text>
                <Group gap="xs" wrap="wrap">
                  <Badge size="xs" variant="dot" color="violet">LLM-powered</Badge>
                  <Badge size="xs" variant="dot" color="violet">CTA slides</Badge>
                </Group>
                <Anchor href="/auto-carousel" underline="never">
                  <Button
                    fullWidth
                    size="md"
                    color="violet"
                    rightSection={<IconLock size={16} />}
                  >
                    Try Auto Carousel
                  </Button>
                </Anchor>
              </Stack>
            </Paper>
          </SimpleGrid>

          {/* Example Carousel */}
          <Stack gap="md" align="center" ta="center">
            <Title order={3}>See it in action</Title>
            <Text size="sm" c="dimmed" maw={480}>
              This carousel was generated entirely by Deckcreate — frames extracted and captions
              pulled directly from a YouTube video.
            </Text>
            <InstagramEmbed url="https://www.instagram.com/p/DU1pIOlj2Uf/" />
          </Stack>

          {/* Philosophy Section */}
          <Paper p="xl" withBorder radius="lg" style={{
            background: 'linear-gradient(135deg, rgba(252,139,148,0.05) 0%, rgba(162,212,209,0.05) 100%)',
          }}>
            <Stack gap="lg" align="center" ta="center">
              <ThemeIcon size={56} radius="xl" variant="light" color="green">
                <IconLeaf size={28} />
              </ThemeIcon>
              <Title order={3}>Built different. On purpose.</Title>
              <Text size="sm" c="dimmed" maw={520}>
                Our <strong>Carousel Generator</strong> and <strong>Transcription</strong> tools use <strong>zero AI</strong>.
                We extract what&apos;s already there — your words, your frames, your content. No large
                language models burning through energy to rephrase what you already said perfectly.
              </Text>
              <Text size="sm" c="dimmed" maw={520}>
                Our <strong>Auto Bulk Carousel</strong> uses AI minimally — only to analyze transcripts
                and suggest segments. The actual content extraction remains AI-free. This approach keeps
                our tools <strong>fast, deterministic, and sustainable</strong>. You get exactly what&apos;s
                in your video — nothing hallucinated, nothing rewritten. Just your authentic content,
                repurposed for every platform.
              </Text>
            </Stack>
          </Paper>

          {/* How It Works */}
          <Stack gap="md" align="center" ta="center">
            <Title order={3}>How it works</Title>
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg" style={{ width: '100%' }}>
              <Stack gap="xs" align="center">
                <ThemeIcon size={40} radius="xl" variant="light" color="primary">
                  <IconBrandYoutube size={20} />
                </ThemeIcon>
                <Text fw={600} size="sm">1. Paste a YouTube link</Text>
                <Text size="xs" c="dimmed">Any public video with auto-captions</Text>
              </Stack>
              <Stack gap="xs" align="center">
                <ThemeIcon size={40} radius="xl" variant="light" color="secondary">
                  <IconSparkles size={20} />
                </ThemeIcon>
                <Text fw={600} size="sm">2. Pick your tool</Text>
                <Text size="xs" c="dimmed">Generate carousels or transcribe the video</Text>
              </Stack>
              <Stack gap="xs" align="center">
                <ThemeIcon size={40} radius="xl" variant="light" color="accent">
                  <IconArrowRight size={20} />
                </ThemeIcon>
                <Text fw={600} size="sm">3. Download & publish</Text>
                <Text size="xs" c="dimmed">Copy text or download images — ready to post</Text>
              </Stack>
            </SimpleGrid>
          </Stack>

          {/* Footer */}
          <Text ta="center" size="xs" c="dimmed" py="md">
            Deckcreate — Content repurposing tools for creators who care about authenticity and sustainability.
          </Text>

        </Stack>
      </Container>
    </div>
  );
}
