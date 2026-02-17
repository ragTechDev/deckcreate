import {
  Container,
  Title,
  Text,
  Stack,
  Paper,
  Group,
  ThemeIcon,
  Anchor,
  Button,
  Divider,
  SimpleGrid,
  Badge,
} from '@mantine/core';
import {
  IconMicrophone,
  IconBulb,
  IconCode,
  IconHeart,
  IconExternalLink,
  IconLeaf,
  IconUsers,
} from '@tabler/icons-react';
import { Header } from '../components/Header';

export default function AboutPage() {
  return (
    <div style={{ minHeight: '100vh', paddingBottom: '3rem' }}>
      <Header />

      <Container size="md" px="md">
        <Stack gap={40} py="xl">

          {/* Intro */}
          <Stack gap="md" align="center" ta="center">
            <Badge size="lg" variant="light" color="secondary" leftSection={<IconMicrophone size={14} />}>
              Built by creators, for creators
            </Badge>
            <Title
              order={1}
              style={{
                fontSize: 'clamp(1.75rem, 4vw, 2.5rem)',
                fontWeight: 800,
                lineHeight: 1.2,
              }}
            >
              The story behind{' '}
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
                Deckcreate
              </Text>
            </Title>
          </Stack>

          {/* Who We Are */}
          <Paper p="xl" withBorder radius="lg">
            <Stack gap="md">
              <Group gap="sm">
                <ThemeIcon size={40} radius="md" variant="light" color="primary">
                  <IconUsers size={20} />
                </ThemeIcon>
                <Title order={3}>Who we are</Title>
              </Group>
              <Text size="sm" c="dimmed" lh={1.7}>
                We&apos;re <strong>ragTech</strong> — a group of tech advocates with a tech podcast
                who are passionate about making technology accessible and understandable. By day,
                we&apos;re fully employed professionals across the tech industry. By night (and weekends),
                we run our podcast and create long-form video vodcasts exploring the topics we care about.
              </Text>
              <Anchor href="https://ragtechdev.com/about" target="_blank" underline="never">
                <Button
                  variant="light"
                  rightSection={<IconExternalLink size={14} />}
                  size="sm"
                >
                  Visit ragTech
                </Button>
              </Anchor>
            </Stack>
          </Paper>

          {/* The Problem */}
          <Paper p="xl" withBorder radius="lg">
            <Stack gap="md">
              <Group gap="sm">
                <ThemeIcon size={40} radius="md" variant="light" color="accent">
                  <IconBulb size={20} />
                </ThemeIcon>
                <Title order={3}>The problem we faced</Title>
              </Group>
              <Text size="sm" c="dimmed" lh={1.7}>
                We were creating long-form video vodcasts that we were genuinely proud of — deep
                conversations about technology, industry trends, and the things that matter to us.
                But they weren&apos;t gaining traction. As part-timers juggling full-time jobs, we simply
                didn&apos;t have the hours to repurpose our content for marketing across social platforms.
              </Text>
              <Text size="sm" c="dimmed" lh={1.7}>
                That changed when we attended a content creation program by{' '}
                <strong>SCAPE* SG</strong>. We learned that content repurposing wasn&apos;t optional — it
                was essential. The best long-form content in the world won&apos;t find its audience if
                you don&apos;t meet people where they are: on Instagram, TikTok, LinkedIn, and beyond.
              </Text>
            </Stack>
          </Paper>

          {/* The Solution */}
          <Paper p="xl" withBorder radius="lg">
            <Stack gap="md">
              <Group gap="sm">
                <ThemeIcon size={40} radius="md" variant="light" color="secondary">
                  <IconCode size={20} />
                </ThemeIcon>
                <Title order={3}>So we built our own tools</Title>
              </Group>
              <Text size="sm" c="dimmed" lh={1.7}>
                Being tech people, we did what came naturally — we wrote scripts. We built internal
                tools to extract frames from our vodcasts, pull captions automatically, and generate
                carousel images we could post across platforms. What used to take hours of manual
                screenshotting and transcribing now takes minutes.
              </Text>
              <Text size="sm" c="dimmed" lh={1.7}>
                These tools worked so well for us that we decided to share them. Deckcreate is
                the result — the same scripts we use internally, wrapped in a clean interface
                that any creator can use. No technical knowledge required.
              </Text>
            </Stack>
          </Paper>

          {/* Our Philosophy */}
          <Paper
            p="xl"
            withBorder
            radius="lg"
            style={{
              background: 'linear-gradient(135deg, rgba(252,139,148,0.05) 0%, rgba(162,212,209,0.05) 100%)',
            }}
          >
            <Stack gap="lg" align="center" ta="center">
              <ThemeIcon size={56} radius="xl" variant="light" color="green">
                <IconLeaf size={28} />
              </ThemeIcon>
              <Title order={3}>Our philosophy</Title>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg" style={{ width: '100%' }}>
                <Stack gap="xs" ta="left">
                  <Text fw={600} size="sm">No AI generation</Text>
                  <Text size="xs" c="dimmed" lh={1.6}>
                    We don&apos;t use AI to rewrite, rephrase, or generate your content. Your words
                    are already good enough — we just help you get them in front of more people.
                    This also means our tools are sustainable and energy-efficient.
                  </Text>
                </Stack>
                <Stack gap="xs" ta="left">
                  <Text fw={600} size="sm">Authenticity first</Text>
                  <Text size="xs" c="dimmed" lh={1.6}>
                    What you see is what you said. We extract the actual captions and frames from
                    your videos. Nothing hallucinated, nothing fabricated. Your audience gets the
                    real you.
                  </Text>
                </Stack>
                <Stack gap="xs" ta="left">
                  <Text fw={600} size="sm">Built for part-timers</Text>
                  <Text size="xs" c="dimmed" lh={1.6}>
                    We know what it&apos;s like to create content with limited time. Our tools are
                    designed to be fast and frictionless — paste a link, click a button, and
                    you&apos;re done.
                  </Text>
                </Stack>
                <Stack gap="xs" ta="left">
                  <Text fw={600} size="sm">Open and honest</Text>
                  <Text size="xs" c="dimmed" lh={1.6}>
                    We&apos;re creators sharing what worked for us. No hype, no inflated promises.
                    Just practical tools that save you time so you can focus on making great content.
                  </Text>
                </Stack>
              </SimpleGrid>
            </Stack>
          </Paper>

          {/* CTA */}
          <Stack gap="md" align="center" ta="center">
            <ThemeIcon size={48} radius="xl" variant="light" color="primary">
              <IconHeart size={24} />
            </ThemeIcon>
            <Title order={3}>Ready to repurpose?</Title>
            <Text size="sm" c="dimmed" maw={480}>
              Focus on creating authentic long-form content. Let Deckcreate handle the rest.
            </Text>
            <Group>
              <Anchor href="/carousel" underline="never">
                <Button size="md">Create Carousel</Button>
              </Anchor>
              <Anchor href="/transcribe" underline="never">
                <Button size="md" variant="light">Transcribe Video</Button>
              </Anchor>
            </Group>
          </Stack>

          {/* Footer */}
          <Divider />
          <Text ta="center" size="xs" c="dimmed">
            Deckcreate is a project by{' '}
            <Anchor href="https://ragtechdev.com/about" target="_blank" size="xs">
              ragTech
            </Anchor>
            {' '}— content repurposing tools for creators who care about authenticity and sustainability.
          </Text>

        </Stack>
      </Container>
    </div>
  );
}
