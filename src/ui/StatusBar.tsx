import { Box, Text } from 'ink'

interface Props {
  left: string
  right: string
  color?: string
}

export function StatusBar({ left, right, color }: Props) {
  return (
    <Box height={1} paddingX={1} justifyContent="space-between">
      <Text color={color} wrap="truncate-end">
        {left}
      </Text>
      <Text dimColor wrap="truncate-end">
        {right}
      </Text>
    </Box>
  )
}
