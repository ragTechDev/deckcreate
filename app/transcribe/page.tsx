import { Container } from '@mantine/core';
import { Header } from '../components/Header';
import { TranscriptionForm } from '../components/TranscriptionForm';

export default function TranscribePage() {
  return (
    <div style={{ minHeight: '100vh', paddingBottom: '2rem' }}>
      <Header />
      <Container size="md" px="md" pt="xl">
        <TranscriptionForm />
      </Container>
    </div>
  );
}
